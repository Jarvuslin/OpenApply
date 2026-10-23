import {
  applicationRuleChangeSchema,
  applicationRulesSchema,
  type ExcludeCompany,
  excludeCompanySchema,
  type UndoApplicationRule,
  undoApplicationRuleSchema,
} from "@openapply/contracts/application-rules";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { listingVisibility } from "@/modules/job-listing/listing-visibility";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { workHash } from "@/modules/work-queue/work-queue.policy";

async function revision(tx: Prisma.TransactionClient, userId: string) {
  return (
    (await tx.applicationRuleChange.findFirst({ where: { userId }, orderBy: { revision: "desc" } }))
      ?.revision ?? 0
  );
}
function replay(value: Prisma.JsonValue) {
  const raw = value as Record<string, unknown>;
  const rule = raw.rule as Record<string, unknown>;
  return applicationRuleChangeSchema.parse({
    ...raw,
    rule: { ...rule, updatedAt: new Date(String(rule.updatedAt)) },
  });
}
@singleton()
export class ApplicationRulesService {
  constructor(private readonly prisma: PrismaClient) {}
  async list(userId: string) {
    return this.prisma.$transaction(
      async (tx) =>
        applicationRulesSchema.parse({
          revision: await revision(tx, userId),
          rules: await tx.applicationRule.findMany({
            where: { userId },
            orderBy: { company: "asc" },
            take: 200,
          }),
        }),
      { isolationLevel: "RepeatableRead" },
    );
  }
  async knownCompany(userId: string, company: string) {
    const exact = company.trim();
    const job = await this.prisma.job.findFirst({
      where: { campaign: { userId }, company: { equals: exact, mode: "insensitive" } },
      select: { company: true },
    });
    const listing =
      job ??
      (await this.prisma.jobListing.findFirst({
        where: {
          AND: [
            listingVisibility(userId),
            { status: "published", company: { equals: exact, mode: "insensitive" } },
          ],
        },
        select: { company: true },
      }));
    return listing && normalizeCompanyName(listing.company) ? listing.company : null;
  }
  async exclude(userId: string, raw: ExcludeCompany, actor: HumanActor) {
    const input = excludeCompanySchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const payloadHash = workHash({ action: "exclude", input });
      const previous = await tx.applicationRuleChange.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw conflict("Rule request ID was reused with different details.");
        return replay(previous.response);
      }
      const company = await this.knownCompany(userId, input.company);
      if (!company) throw notFound("Choose the exact name of a known company.");
      const current = await revision(tx, userId);
      if (current !== input.expectedRevision)
        throw conflict("Application rules changed. Reload before changing them.");
      const companyKey = normalizeCompanyName(company);
      const existing = await tx.applicationRule.findUnique({
        where: { userId_companyKey: { userId, companyKey } },
      });
      if (!existing && (await tx.applicationRule.count({ where: { userId } })) >= 200)
        throw conflict("The account has reached its 200 company-rule limit.");
      const rule = await tx.applicationRule.upsert({
        where: { userId_companyKey: { userId, companyKey } },
        create: { userId, company, companyKey, revision: current + 1 },
        update: { active: true, revision: current + 1 },
      });
      const result = applicationRuleChangeSchema.parse({
        id: crypto.randomUUID(),
        revision: current + 1,
        rule,
        undoAvailable: !existing?.active,
      });
      await tx.applicationRuleChange.create({
        data: {
          id: result.id,
          userId,
          requestId: input.requestId,
          payloadHash,
          ruleId: rule.id,
          revision: current + 1,
          previousActive: existing?.active ?? false,
          nextActive: true,
          authorship,
          response: toInputJson(result),
        },
      });
      return result;
    });
  }
  async undo(userId: string, id: string, raw: UndoApplicationRule, actor: HumanActor) {
    const input = undoApplicationRuleSchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const payloadHash = workHash({ action: "undo", id, input });
      const previous = await tx.applicationRuleChange.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw conflict("Undo request ID was reused.");
        return replay(previous.response);
      }
      const change = await tx.applicationRuleChange.findFirst({ where: { id, userId } });
      if (!change) throw notFound("Application rule change not found.");
      const current = await revision(tx, userId);
      if (
        change.undoneAt ||
        current !== input.expectedRevision ||
        current !== change.revision ||
        change.previousActive === change.nextActive
      )
        throw conflict("This Undo is stale. Review the current application rules.");
      const rule = await tx.applicationRule.update({
        where: { id: change.ruleId },
        data: { active: change.previousActive, revision: current + 1 },
      });
      const result = applicationRuleChangeSchema.parse({
        id: crypto.randomUUID(),
        revision: current + 1,
        rule,
        undoAvailable: false,
      });
      await tx.applicationRuleChange.update({ where: { id }, data: { undoneAt: new Date() } });
      await tx.applicationRuleChange.create({
        data: {
          id: result.id,
          userId,
          requestId: input.requestId,
          payloadHash,
          ruleId: rule.id,
          revision: current + 1,
          previousActive: change.nextActive,
          nextActive: change.previousActive,
          authorship,
          response: toInputJson(result),
        },
      });
      return result;
    });
  }
}
