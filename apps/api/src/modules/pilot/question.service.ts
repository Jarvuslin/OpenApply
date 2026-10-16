import type {
  AnswerPilotQuestionInput,
  CreatePilotQuestionInput,
  PilotQuestionStatus,
} from "@openapply/contracts/pilot";
import { needsYouChannel, pilotChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { conflict, findOwned, notFound } from "@/common/errors";
import { PushService } from "@/common/push/push.service";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { resumeAnsweredJob } from "@/modules/application-question/question.resume";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { pilotQuestionView } from "./question.view";

/** An unanswered 2FA code is useless within minutes, and expiring it frees the job it parked. */
const TWO_FACTOR_TTL_MS = 5 * 60 * 1000;

function expiryOf(body: CreatePilotQuestionInput): Date | null {
  if (body.expiresAt) return new Date(body.expiresAt);
  if (body.kind === "two_factor") return new Date(Date.now() + TWO_FACTOR_TTL_MS);
  return null;
}

@singleton()
export class PilotQuestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly push: PushService,
  ) {}

  async createQuestion(userId: string, body: CreatePilotQuestionInput) {
    if (body.subjectType === "account_setup")
      throw conflict("Account handoffs are created by the scoped account setup workflow.");
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      if (body.subjectType === "job") {
        const job =
          body.subjectId &&
          (await tx.job.findFirst({
            where: { id: body.subjectId, campaign: { userId } },
            select: { id: true },
          }));
        if (!job) throw notFound("Owned job not found; queue questions use the job UUID.");
      }
      const question = await tx.pilotQuestion.create({
        data: {
          userId,
          kind: body.kind,
          subjectType: body.subjectType ?? null,
          subjectId: body.subjectId ?? null,
          prompt: body.prompt,
          options: body.options,
          deepLink: body.deepLink ?? null,
          expiresAt: expiryOf(body),
        },
      });
      return question;
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
    const question = pilotQuestionView(row);
    publish(pilotChannel, { userId }, { type: "question.created", question });
    void this.push.sendToUser(userId, {
      title: "OpenApply needs you",
      body: "Your agent needs an answer. Open OpenApply to reply.",
      url: row.deepLink ?? "/needs-you",
      tag: `question-${row.id}`,
    });
    return question;
  }

  /** Unpaginated: the attention panel shows every open question, and there are few. */
  async listQuestions(userId: string, status?: PilotQuestionStatus) {
    const rows = await this.prisma.pilotQuestion.findMany({
      where: {
        userId,
        status,
        applicationQuestionId: null,
        ...(status === "open"
          ? { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(pilotQuestionView);
  }

  async answerQuestion(userId: string, id: string, body: AnswerPilotQuestionInput) {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const linked = await tx.pilotQuestion.findFirst({ where: { id, userId } });
      if (linked?.subjectType === "account_setup")
        throw conflict(
          "Use the secure account setup credential or continuation action for this handoff.",
        );
      if (linked?.approvalAttemptId)
        throw conflict("Use the exact-checkpoint human decision action for this approval.");
      if (linked?.applicationQuestionId)
        throw conflict(
          "This question moved to application questions. Review and confirm its current revision.",
        );
      const [answered] = await tx.pilotQuestion.updateManyAndReturn({
        where: {
          id,
          userId,
          status: "open",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: "answered", answer: body.answer, answeredAt: new Date() },
      });
      if (!answered) {
        const existing = await findOwned(
          (where) => tx.pilotQuestion.findFirst({ where }),
          { id, userId },
          "Question",
        );
        if (existing.status === "answered" && existing.answer === body.answer) return existing;
        throw conflict("Question is no longer open.");
      }
      if (answered.subjectType === "job" && answered.subjectId)
        await resumeAnsweredJob(tx, userId, answered.subjectId);

      return answered;
    });

    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
    const question = pilotQuestionView(row);
    publish(pilotChannel, { userId }, { type: "question.answered", question });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return question;
  }
}
