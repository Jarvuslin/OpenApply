import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { DEFAULT_MIN_MATCH_SCORE } from "@openapply/contracts/user";
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

type BatchJob = { fitAssessment: Prisma.JsonValue; url: string; campaign: { status: string } };

/** A job a queue batch can score: still unscored, in an active search, on a page it may open. */
function batchable(job: BatchJob) {
  return (
    job.fitAssessment == null &&
    job.campaign.status === "in_progress" &&
    job.url.startsWith("https://")
  );
}

/**
 * Whether this application waits for a scoring batch: its own, or the next one while queue
 * scoring is under way. Without a queue batch (e.g. a manual approval) nothing is held.
 */
export async function waitingForScore(
  tx: Prisma.TransactionClient,
  item: { userId: string; payload: Prisma.JsonValue },
  job: BatchJob,
) {
  const id = scoreBatchOf(item.payload);
  if (!id && !batchable(job)) return false;
  const batch = await tx.workItem.findFirst({
    where: id
      ? { id, state: { in: OPEN_BATCH_STATES } }
      : {
          userId: item.userId,
          intent: "pilot_score",
          identity: { startsWith: "queue-score:" },
          state: { in: OPEN_BATCH_STATES },
        },
    select: { id: true },
  });
  return !!batch;
}

/**
 * Skips queued applications that can't pass, so no application run starts for them: a job the
 * worker already skipped, or one a queue batch scored below the campaign minimum.
 */
export async function skipScoredOut(tx: Prisma.TransactionClient, userId: string) {
  const queued = await tx.workItem.findMany({
    where: { userId, kind: "application", state: "queued", jobId: { not: null } },
    select: { id: true, jobId: true, payload: true },
  });
  if (!queued.length) return;
  const jobs = await tx.job.findMany({
    where: { id: { in: queued.map((item) => item.jobId!) } },
    select: {
      id: true,
      status: true,
      skipReason: true,
      matchScore: true,
      fitAssessment: true,
      url: true,
      campaign: { select: { config: true, status: true } },
    },
  });
  let profileMinimum: number | undefined;
  for (const item of queued) {
    const job = jobs.find((row) => row.id === item.jobId);
    if (!job) continue;
    let reason = job.status === "skipped" ? (job.skipReason ?? "Scored below your minimum.") : null;
    // The worker may leave a low score for the queue to settle, so the batch result decides here.
    if (
      !reason &&
      scoreBatchOf(item.payload) &&
      !(await waitingForScore(tx, { userId, payload: item.payload }, job))
    ) {
      profileMinimum ??=
        (
          await tx.user.findUnique({
            where: { id: userId },
            select: { autoApply: { select: { minMatchScore: true } } },
          })
        )?.autoApply?.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;
      const minimum = campaignConfigSchema.parse(job.campaign.config).minScore ?? profileMinimum;
      if (job.fitAssessment != null && job.matchScore != null && job.matchScore < minimum)
        reason = `Scored ${job.matchScore}, below your minimum of ${minimum}.`;
    }
    if (!reason) continue;
    if (job.status !== "skipped")
      await tx.job.updateMany({
        where: {
          id: job.id,
          status: { in: ["queued", "pending", "approved"] },
          submissionAttempt: null,
        },
        data: { status: "skipped", skipReason: reason },
      });
    await tx.workItem.update({
      where: { id: item.id },
      data: { state: "skipped", reason, finishedAt: new Date() },
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
    return job && batchable(job) && !scoreBatchOf(item.payload);
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
