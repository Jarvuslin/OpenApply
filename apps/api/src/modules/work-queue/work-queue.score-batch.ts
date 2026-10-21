import type { Prisma, WorkState } from "@/generated/prisma/client";
import { LIVE_WORK_STATES } from "./work-queue.policy";

const BATCH_SIZE = 5;
const OPEN_BATCH_STATES: WorkState[] = ["queued", ...LIVE_WORK_STATES];

function payloadObject(payload: Prisma.JsonValue): Prisma.JsonObject {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Prisma.JsonObject)
    : {};
}

/** The queue scoring batch an application was handed to, if any. */
function scoreBatchOf(payload: Prisma.JsonValue): string | null {
  const id = payloadObject(payload).scoreBatchId;
  return typeof id === "string" ? id : null;
}

/** Whether this application waits for a scoring batch that hasn't finished yet. */
export async function waitingForScore(tx: Prisma.TransactionClient, payload: Prisma.JsonValue) {
  const id = scoreBatchOf(payload);
  if (!id) return false;
  const batch = await tx.workItem.findFirst({
    where: { id, state: { in: OPEN_BATCH_STATES } },
    select: { id: true },
  });
  return !!batch;
}

/** A job the batch scored below the minimum is skipped here, so no application run starts. */
export async function skipScoredOut(tx: Prisma.TransactionClient, userId: string) {
  const queued = await tx.workItem.findMany({
    where: { userId, kind: "application", state: "queued", jobId: { not: null } },
    select: { id: true, jobId: true },
  });
  if (!queued.length) return;
  const skipped = await tx.job.findMany({
    where: { id: { in: queued.map((item) => item.jobId!) }, status: "skipped" },
    select: { id: true, skipReason: true },
  });
  for (const job of skipped) {
    const item = queued.find((row) => row.jobId === job.id)!;
    await tx.workItem.update({
      where: { id: item.id },
      data: {
        state: "skipped",
        reason: job.skipReason ?? "Scored below your minimum.",
        finishedAt: new Date(),
      },
    });
  }
}

/**
 * Hands the next few unscored queued jobs to one scoring run, so the worker skips low scorers
 * before an application run starts. It keeps about one batch of scored jobs ahead of the
 * worker instead of scoring the whole queue up front.
 */
export async function queueScoreBatch(tx: Prisma.TransactionClient, userId: string) {
  // One scoring run at a time, a pilot's included, so scoring never crowds out applying.
  const open = await tx.workItem.findFirst({
    where: { userId, intent: "pilot_score", state: { in: OPEN_BATCH_STATES } },
    select: { id: true },
  });
  if (open) return null;
  const queued = await tx.workItem.findMany({
    where: { userId, kind: "application", state: "queued", jobId: { not: null } },
    orderBy: [
      { priorityRequestedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: { id: true, jobId: true, campaignId: true, payload: true, provider: true },
  });
  const jobs = await tx.job.findMany({
    where: { id: { in: queued.map((item) => item.jobId!) }, campaign: { userId } },
    select: { id: true, url: true, fitAssessment: true, campaign: { select: { status: true } } },
  });
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const scored = queued.filter((item) => byId.get(item.jobId!)?.fitAssessment != null);
  if (scored.length >= BATCH_SIZE) return null;
  const unscored = queued.filter((item) => {
    const job = byId.get(item.jobId!);
    // A job a batch already tried and couldn't score is scored inside its own application run.
    return (
      job &&
      job.fitAssessment == null &&
      job.campaign.status === "in_progress" &&
      job.url.startsWith("https://") &&
      !scoreBatchOf(item.payload)
    );
  });
  const campaignId = unscored[0]?.campaignId;
  if (!campaignId) return null;
  // The scoring run works inside one campaign, so a batch never mixes campaigns.
  const picked = unscored.filter((item) => item.campaignId === campaignId).slice(0, BATCH_SIZE);
  const jobIds = picked.map((item) => item.jobId!);
  const batch = await tx.workItem.create({
    data: {
      userId,
      kind: "pilot_task",
      source: "user",
      provider: picked[0]!.provider,
      identity: `queue-score:${crypto.randomUUID()}`,
      campaignId,
      intent: "pilot_score",
      title: `Score ${jobIds.length} queued ${jobIds.length === 1 ? "job" : "jobs"}`,
      payload: { source: "queue", jobIds },
    },
  });
  for (const item of picked)
    await tx.workItem.update({
      where: { id: item.id },
      data: { payload: { ...payloadObject(item.payload), scoreBatchId: batch.id } },
    });
  return batch;
}
