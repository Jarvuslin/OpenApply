import type { Prisma } from "@/generated/prisma/client";
import { canonicalWorkOutcome } from "@/modules/work-queue/work-queue.recovery";
import { resolvedDocumentFields } from "./document.policy";
import { questionBlockers } from "./question.resolution";

export async function hasJobQuestionBlockers(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const [canonical, operational] = await Promise.all([
    tx.applicationQuestion.findMany({
      where: { userId, jobId, current: true },
      include: { answers: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    tx.pilotQuestion.count({
      where: {
        userId,
        subjectType: "job",
        subjectId: jobId,
        applicationQuestionId: null,
        status: "open",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
  ]);
  const blockers = questionBlockers(canonical, await resolvedDocumentFields(tx, userId, jobId));
  // Partial form coverage is normal behind an employer login; the worker reviews every field before submit.
  return [...blockers.values()].some(Boolean) || operational > 0;
}

export async function resumeAnsweredJob(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const item = await tx.workItem.findFirst({
    where: {
      userId,
      jobId,
      state: "needs_user",
      pauseRequestedAt: null,
      cancellationRequestedAt: null,
    },
  });
  if (!item || (await hasJobQuestionBlockers(tx, userId, jobId))) return false;
  const campaign = item.campaignId
    ? await tx.campaign.findFirst({ where: { campaignId: item.campaignId, userId } })
    : null;
  if (campaign?.status !== "in_progress") return false;
  const outcome = await canonicalWorkOutcome(tx, item, "completed");
  if (outcome.ambiguous || outcome.state === "submitted") return false;
  await tx.workItem.update({
    where: { id: item.id },
    data: {
      state: "queued",
      reason: null,
      finishedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  await reopenParkedJob(tx, jobId);
  return true;
}

/** Queued again, a parked job is ready to apply; the worker no longer has to move it back itself. */
export async function reopenParkedJob(tx: Prisma.TransactionClient, jobId: string) {
  await tx.job.updateMany({
    where: { id: jobId, status: "needs_user" },
    data: { status: "approved" },
  });
}
