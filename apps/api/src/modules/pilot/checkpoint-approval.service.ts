import {
  type CheckpointDecision,
  checkpointDecisionSchema,
} from "@openapply/contracts/checkpoint-approval";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import {
  type Job,
  type Prisma,
  PrismaClient,
  type SubmissionAttempt,
} from "@/generated/prisma/client";
import { canonicalizeIntakeUrl } from "@/modules/application/job-url";
import { resumeAnsweredJob } from "@/modules/application-question/question.resume";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { workHash } from "@/modules/work-queue/work-queue.policy";
import { pilotQuestionView } from "./question.view";

async function requiresHumanApproval(tx: Prisma.TransactionClient, userId: string, job: Job) {
  if (job.humanApprovalRequired) return true;
  const url = canonicalizeIntakeUrl(job.url);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM job_intakes WHERE user_id=${userId} AND (canonical_url=${url} OR original_url=${url}) LIMIT 1`;
  return rows.length > 0;
}

export async function requireCheckpointApproval(
  tx: Prisma.TransactionClient,
  userId: string,
  job: Job,
  attempt: SubmissionAttempt,
) {
  if (!(await requiresHumanApproval(tx, userId, job))) return;
  if (!attempt.checkpointId || !attempt.checkpointHash || attempt.startedAt)
    throw conflict("A current unsubmitted checkpoint is required.");
  const checkpoint = attempt.checkpoint as { job?: { updatedAt?: string } } | null;
  if (checkpoint?.job?.updatedAt !== job.updatedAt.toISOString())
    throw conflict("The reviewed checkpoint is stale; prepare it from the current job first.");
  const prior = await tx.pilotQuestion.findFirst({
    where: {
      userId,
      approvalAttemptId: attempt.id,
      approvalCheckpointId: attempt.checkpointId,
      approvalCheckpointHash: attempt.checkpointHash,
      approvalJobUpdatedAt: job.updatedAt,
      expiresAt: { gt: new Date() },
      status: { in: ["open", "answered"] },
    },
  });
  if (prior) return;
  await tx.pilotQuestion.updateMany({
    where: { userId, approvalAttemptId: attempt.id, status: "open" },
    data: { status: "cancelled" },
  });
  const id = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 30 * 60_000);
  await tx.pilotQuestion.create({
    data: {
      id,
      userId,
      kind: "approval",
      subjectType: "job",
      subjectId: job.id,
      prompt: "Review the exact application checkpoint and PDF before approving Submit.",
      options: ["Approve submission", "Skip application"],
      deepLink: "/needs-you",
      expiresAt,
      approvalAttemptId: attempt.id,
      approvalCheckpointId: attempt.checkpointId,
      approvalCheckpointHash: attempt.checkpointHash,
      approvalJobUpdatedAt: job.updatedAt,
      approval: toInputJson({
        questionId: id,
        checkpointId: attempt.checkpointId,
        checkpointHash: attempt.checkpointHash,
        expiresAt,
        decision: null,
        consumedAt: null,
        job: {
          id: job.id,
          campaignId: job.campaignId,
          key: job.key,
          title: job.title,
          company: job.company,
        },
        reviewPath: `/needs-you?target=${id}`,
      }),
    },
  });
}

export async function consumeCheckpointApproval(
  tx: Prisma.TransactionClient,
  userId: string,
  job: Job,
  attempt: SubmissionAttempt,
) {
  if (!(await requiresHumanApproval(tx, userId, job))) return;
  const approval = await tx.pilotQuestion.findFirst({
    where: {
      userId,
      approvalAttemptId: attempt.id,
      approvalCheckpointId: attempt.checkpointId,
      approvalCheckpointHash: attempt.checkpointHash,
      approvalJobUpdatedAt: job.updatedAt,
      status: "answered",
      approvalDecision: "approve",
      approvalAuthorship: { in: ["session_user", "telegram_user"] },
      approvalConsumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!approval)
    throw conflict("This exact checkpoint requires a current human approval before Submit.");
  const changed = await tx.pilotQuestion.updateMany({
    where: { id: approval.id, approvalConsumedAt: null },
    data: { approvalConsumedAt: new Date() },
  });
  if (changed.count !== 1) throw conflict("Checkpoint approval was already consumed.");
}

@singleton()
export class PilotCheckpointApprovalService {
  constructor(private readonly prisma: PrismaClient) {}
  async read(userId: string, id: string) {
    const row = await this.prisma.pilotQuestion.findFirst({
      where: { id, userId, approvalAttemptId: { not: null } },
    });
    if (!row) throw notFound("Checkpoint approval not found.");
    return pilotQuestionView(row);
  }
  async decide(userId: string, id: string, raw: CheckpointDecision, actor: HumanActor) {
    const input = checkpointDecisionSchema.parse(raw);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const row = await tx.pilotQuestion.findFirst({ where: { id, userId } });
      if (!row?.approvalAttemptId || !row.subjectId)
        throw notFound("Checkpoint approval not found.");
      const payloadHash = workHash({ id, input });
      const prior = await tx.pilotQuestion.findFirst({
        where: { userId, approvalRequestId: input.requestId },
      });
      if (prior && prior.id !== id)
        throw conflict("Approval request ID was reused for another checkpoint.");
      if (row.approvalRequestId === input.requestId) {
        if (row.approvalPayloadHash !== payloadHash)
          throw conflict("Approval request ID was reused.");
        return row;
      }
      if (
        row.status !== "open" ||
        !row.expiresAt ||
        row.expiresAt <= new Date() ||
        row.approvalCheckpointId !== input.checkpointId ||
        row.approvalCheckpointHash !== input.checkpointHash
      )
        throw conflict("This approval changed or expired. Review the current checkpoint.");
      const attempt = await tx.submissionAttempt.findFirst({
        where: {
          id: row.approvalAttemptId,
          userId,
          checkpointId: input.checkpointId,
          checkpointHash: input.checkpointHash,
          startedAt: null,
          legacyOutcomeUnknown: false,
        },
      });
      const job = await tx.job.findFirst({
        where: { id: row.subjectId, campaign: { userId }, updatedAt: row.approvalJobUpdatedAt! },
      });
      if (!attempt || !job || attempt.jobId !== job.id)
        throw conflict("The job, answers, documents or checkpoint changed after review.");
      const decided = await tx.pilotQuestion.update({
        where: { id },
        data: {
          status: "answered",
          answer: input.decision,
          answeredAt: new Date(),
          approvalDecision: input.decision,
          approvalAuthorship: authorship,
          approvalRequestId: input.requestId,
          approvalPayloadHash: payloadHash,
        },
      });
      if (input.decision === "skip") {
        await tx.job.update({
          where: { id: job.id },
          data: {
            status: "skipped",
            skipReason: "Skipped by the person reviewing this application checkpoint.",
          },
        });
        const item = await tx.workItem.findFirst({ where: { userId, jobId: job.id } });
        if (item)
          await tx.workItem.update({
            where: { id: item.id },
            data: {
              state: item.leaseToken ? "stopping" : "cancelled",
              cancellationRequestedAt: new Date(),
              reason: "The applicant declined this checkpoint.",
            },
          });
      } else await resumeAnsweredJob(tx, userId, job.id);
      return decided;
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return pilotQuestionView(result);
  }
}
