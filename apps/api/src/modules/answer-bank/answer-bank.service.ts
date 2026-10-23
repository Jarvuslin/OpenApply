import { answerMatchesSchema, type BankListQuery } from "@openapply/contracts/answer-bank";
import {
  type AnswerMatchesInput,
  answerMatchesInputSchema,
  type ReviseBankEntry,
  type RevokeBankEntry,
  reviseBankEntrySchema,
  revokeBankEntrySchema,
} from "@openapply/contracts/answer-bank-input";
import { questionDefinitionSchema } from "@openapply/contracts/application-question";
import { type PaginationQuery, pageSlice, paginate } from "@openapply/contracts/pagination";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { badRequest, conflict, notFound } from "@/common/errors";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { questionHash } from "@/modules/application-question/question.policy";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { findBankMatches } from "./answer-bank.matches";
import { bankEligibility } from "./answer-bank.policy";
import { bankRevisionInclude, bankView, saveConfirmedAnswer } from "./answer-bank.store";

const latestInclude = {
  revisions: { orderBy: { revision: "desc" as const }, take: 1, include: bankRevisionInclude },
} as const;

@singleton()
export class AnswerBankService {
  constructor(private readonly prisma: PrismaClient) {}

  async matches(userId: string, questionId: string, raw: AnswerMatchesInput, actor: HumanActor) {
    const input = answerMatchesInputSchema.parse(raw);
    return this.prisma.$transaction(
      async (tx) => {
        await lockWorkUser(tx, userId);
        await assertHumanActor(tx, userId, actor);
        const question = await tx.applicationQuestion.findFirst({
          where: { id: questionId, userId },
          include: { job: true },
        });
        if (!question) throw notFound("Application question not found");
        if (
          !question.current ||
          question.revision !== input.expectedRevision ||
          question.definitionHash !== input.expectedDefinitionHash
        )
          throw conflict(
            "Question changed. Review its current revision before matching saved answers.",
          );
        const target = {
          definition: questionDefinitionSchema.parse(question.definition),
          category: question.category,
          countryCode: input.countryCode ?? null,
          countryConfirmed: input.countryConfirmed === true,
          company: question.job.company,
          jobTitle: question.job.title,
        };
        const found = await findBankMatches(tx, userId, target);
        if (!found)
          return answerMatchesSchema.parse({
            status: "unavailable",
            reason: bankEligibility(target.definition, target.category, target, "employer").reason,
            matches: [],
          });
        const matches = found.map(({ bankRevisionId: _, ...match }) => match);
        let status: "none" | "matched" | "ambiguous" = "none";
        let reason: string | null =
          "No current, consented saved answer matches this exact question and context.";
        if (matches.length === 1) {
          status = "matched";
          reason = null;
        }
        if (matches.length > 1) {
          status = "ambiguous";
          reason =
            "Several saved answers match. Review their scope and answer this question directly.";
        }
        return answerMatchesSchema.parse({ status, reason, matches: matches.slice(0, 20) });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async list(userId: string, query: BankListQuery) {
    const where: Prisma.AnswerBankEntryWhereInput = {
      userId,
      ...(query.status === "all" ? {} : { active: query.status === "active" }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.answerBankEntry.findMany({
            where,
            ...pageSlice(query),
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            include: latestInclude,
          }),
          tx.answerBankEntry.count({ where }),
        ]);
        return paginate(
          rows.map((row) => bankView(row.revisions[0])),
          query,
          total,
        );
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async detail(userId: string, id: string, query: PaginationQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const entry = await tx.answerBankEntry.findFirst({
          where: { id, userId },
          include: latestInclude,
        });
        if (!entry) throw notFound("Saved answer not found");
        const where = { userId, entryId: id };
        const [rows, total] = await Promise.all([
          tx.answerBankRevision.findMany({
            where,
            ...pageSlice(query),
            orderBy: { revision: "desc" },
            include: bankRevisionInclude,
          }),
          tx.answerBankRevision.count({ where }),
        ]);
        return {
          entry: bankView(entry.revisions[0]),
          revisions: paginate(rows.map(bankView), query, total),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async revoke(userId: string, id: string, raw: RevokeBankEntry, actor: HumanActor) {
    const input = revokeBankEntrySchema.parse(raw);
    const payloadHash = questionHash({ id, input, action: "revoke" });
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertHumanActor(tx, userId, actor);
      const previous = await tx.answerBankRevision.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
        include: bankRevisionInclude,
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw conflict("Revocation request ID was reused.");
        return previous;
      }
      const entry = await tx.answerBankEntry.findFirst({
        where: { id, userId },
        include: latestInclude,
      });
      if (!entry) throw notFound("Saved answer not found");
      if (!entry.active || entry.currentRevision !== input.expectedRevision)
        throw conflict("The saved answer changed. Review its current revision before revoking it.");
      const latest = entry.revisions[0];
      await tx.answerBankEntry.update({
        where: { id },
        data: { active: false, currentRevision: entry.currentRevision + 1 },
      });
      return tx.answerBankRevision.create({
        data: {
          userId,
          entryId: id,
          revision: entry.currentRevision + 1,
          action: "revoke",
          requestId: input.requestId,
          payloadHash,
          sourceAnswerId: latest.sourceAnswerId,
          sourceSnapshot: latest.sourceSnapshot as Prisma.InputJsonValue,
          fingerprint: latest.fingerprint,
          normalizerVersion: latest.normalizerVersion,
          scope: latest.scope,
          category: latest.category,
          countryCode: latest.countryCode,
          employerKey: latest.employerKey,
          roleKey: latest.roleKey,
          consentedAt: latest.consentedAt,
        },
        include: bankRevisionInclude,
      });
    });
    return bankView(row);
  }

  async revise(userId: string, id: string, raw: ReviseBankEntry, actor: HumanActor) {
    const input = reviseBankEntrySchema.parse(raw);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertHumanActor(tx, userId, actor);
      const entry = await tx.answerBankEntry.findFirst({
        where: { id, userId },
        include: latestInclude,
      });
      if (!entry) throw notFound("Saved answer not found");
      const latest = entry.revisions[0];
      if (latest.countryCode && input.countryConfirmed !== true)
        throw badRequest("Confirm that the correction applies to this saved answer's country.");
      return saveConfirmedAnswer(
        tx,
        userId,
        input.sourceAnswerId,
        {
          consent: true,
          scope: latest.scope,
          ...(latest.countryCode
            ? { countryCode: latest.countryCode, countryConfirmed: true }
            : {}),
          expectedBank: { entryId: id, revision: input.expectedRevision },
        },
        input.requestId,
      );
    });
    return bankView(row);
  }
}
