import { campaignConfigSchema } from "@openapply/contracts/campaign";
import type { AgendaPayload } from "@openapply/contracts/pilot";
import { z } from "zod/v4";
import { DAY_MS } from "@/common/date/buckets";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { summarizeCampaigns } from "@/modules/campaign/campaign.summary";
import { PROMOTABLE_SOURCES } from "@/modules/campaign/campaign.utils";
import { GATHER_CAP } from "./items";

const BATCH_SIZE = 5;
const PAUSED_CANDIDATES = 20;
const STRATEGY_MIN_JOBS = 20;
const STRATEGY_MAX_QUALIFIED_RATIO = 0.2;
const RESCAN_MIN_SKIPPED = 5;
const RETRY_MIN_FAILED = 3;
const TOP_SKIP_REASONS = 3;
const REVIEW_REPEAT_MS = 7 * DAY_MS;

/** Pending rows a worker must open for missing posting details or original-source evidence. */
const NEEDS_WORKER_VISIT = {
  status: "pending",
  OR: [
    { matchScore: null },
    { digest: null },
    { fitAssessment: { equals: Prisma.DbNull } },
    { fitAssessment: { path: ["roleMatch", "family"], equals: "Unclear" } },
  ],
} satisfies Prisma.JobWhereInput;

const QUEUED = { status: "queued" } satisfies Prisma.JobWhereInput;

/** Application campaigns holding rows that still need posting details or role inspection. */
export async function gatherScorePending(
  prisma: PrismaClient,
  userId: string,
  fallbackMinScore: number,
): Promise<AgendaPayload<"campaign.scorePending">[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      userId,
      status: "in_progress",
      source: { in: PROMOTABLE_SOURCES },
      jobs: { some: NEEDS_WORKER_VISIT },
    },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      query: true,
      config: true,
      _count: { select: { jobs: { where: NEEDS_WORKER_VISIT } } },
      jobs: {
        where: NEEDS_WORKER_VISIT,
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { key: true, url: true, title: true },
      },
    },
  });
  return campaigns.map((campaign) => {
    const config = campaignConfigSchema.parse(campaign.config);
    return {
      campaignId: campaign.campaignId,
      query: campaign.query,
      board: config.board ?? null,
      resumeId: config.resumeId,
      minScore: config.minScore ?? fallbackMinScore,
      pendingCount: campaign._count.jobs,
      entries: campaign.jobs,
    };
  });
}

/** Apply campaigns holding pasted links nothing has visited yet. */
export async function gatherQueueDrains(
  prisma: PrismaClient,
  userId: string,
  fallbackMinScore: number,
): Promise<AgendaPayload<"queue.drain">[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { userId, status: "in_progress", source: "apply", jobs: { some: QUEUED } },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      config: true,
      _count: { select: { jobs: { where: QUEUED } } },
      jobs: {
        where: QUEUED,
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { key: true, url: true },
      },
    },
  });
  return campaigns.map((campaign) => {
    const config = campaignConfigSchema.parse(campaign.config);
    return {
      campaignId: campaign.campaignId,
      resumeId: config.resumeId,
      minScore: config.minScore ?? fallbackMinScore,
      queuedCount: campaign._count.jobs,
      entries: campaign.jobs,
    };
  });
}

/** Paused auto-apply campaigns, longest paused first, that nobody has decided on yet. */
export async function gatherPausedCampaigns(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"campaign.reviewPaused">[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { userId, status: "paused", source: "auto_apply" },
    orderBy: { updatedAt: "asc" },
    take: PAUSED_CANDIDATES,
    select: { campaignId: true, query: true, config: true, updatedAt: true },
  });
  if (campaigns.length === 0) return [];

  const questions = await prisma.pilotQuestion.findMany({
    where: {
      userId,
      subjectType: "campaign",
      subjectId: { in: campaigns.map((campaign) => campaign.campaignId) },
      status: { in: ["open", "answered"] },
    },
    take: PAUSED_CANDIDATES,
    select: { subjectId: true, status: true, answeredAt: true },
  });
  const questionsByCampaign = Map.groupBy(questions, (question) => question.subjectId);

  return campaigns
    .filter(
      (campaign) =>
        // An answer older than the pause belongs to an earlier pause episode.
        !(questionsByCampaign.get(campaign.campaignId) ?? []).some(
          (q) => q.status === "open" || (q.answeredAt != null && q.answeredAt > campaign.updatedAt),
        ),
    )
    .map((campaign) => ({
      campaignId: campaign.campaignId,
      query: campaign.query,
      board: campaignConfigSchema.parse(campaign.config).board ?? null,
      pausedAt: campaign.updatedAt,
    }));
}

const reviewMarkerSchema = z.object({ type: z.string().optional() }).loose();

/**
 * Strategy reviews, skipped-job rescans and failed-job retries for a quiet agenda. The agent
 * journals an action with `detail.type` after each, which holds the campaign back for a week.
 */
export async function gatherCampaignReviews(prisma: PrismaClient, userId: string, now: Date) {
  const [campaigns, markers] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId, status: "in_progress", source: { in: ["search", "auto_apply", "apply"] } },
      select: { campaignId: true, query: true, config: true, source: true },
    }),
    prisma.pilotJournalEntry.findMany({
      where: {
        userId,
        kind: "action",
        subjectType: "campaign",
        createdAt: { gte: new Date(now.getTime() - REVIEW_REPEAT_MS) },
      },
      select: { subjectId: true, detail: true },
    }),
  ]);
  const marked = new Set(
    markers.map((marker) => `${reviewMarkerSchema.parse(marker.detail).type}:${marker.subjectId}`),
  );
  const isFresh = (type: string, campaignId: string) => !marked.has(`${type}:${campaignId}`);

  const strategyReviews: AgendaPayload<"campaign.strategyReview">[] = [];
  const rescanSkipped: AgendaPayload<"job.rescanSkipped">[] = [];
  const retryFailed: AgendaPayload<"job.retryFailed">[] = [];

  const summaries = await summarizeCampaigns(prisma, campaigns);
  for (const { campaignId, query, config, summary } of summaries) {
    if (summary.kind !== "jobs") continue;
    const converting = summary.qualified / summary.totalFound >= STRATEGY_MAX_QUALIFIED_RATIO;
    if (
      summary.totalFound >= STRATEGY_MIN_JOBS &&
      !converting &&
      isFresh("strategyReview", campaignId)
    ) {
      const { minScore, board } = campaignConfigSchema.parse(config);
      strategyReviews.push({
        campaignId,
        query,
        config: { minScore: minScore ?? null, board: board ?? null },
        counts: {
          totalFound: summary.totalFound,
          qualified: summary.qualified,
          applied: summary.applied,
          skipped: summary.skipped,
        },
        topSkipReasons: [],
      });
    }
    if (summary.skipped >= RESCAN_MIN_SKIPPED && isFresh("rescanSkipped", campaignId)) {
      rescanSkipped.push({ campaignId, skippedCount: summary.skipped });
    }
    if (summary.failed >= RETRY_MIN_FAILED && isFresh("retryFailed", campaignId)) {
      retryFailed.push({ campaignId, failedCount: summary.failed });
    }
  }

  if (strategyReviews.length > 0) {
    const reasons = await prisma.job.groupBy({
      by: ["campaignId", "skipReason"],
      where: {
        campaignId: { in: strategyReviews.map((review) => review.campaignId) },
        status: "skipped",
        skipReason: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { skipReason: "desc" } },
    });
    const reasonsByCampaign = Map.groupBy(reasons, (row) => row.campaignId);
    for (const review of strategyReviews) {
      review.topSkipReasons = (reasonsByCampaign.get(review.campaignId) ?? [])
        .flatMap((row) => (row.skipReason ? [row.skipReason] : []))
        .slice(0, TOP_SKIP_REASONS);
    }
  }
  return { strategyReviews, rescanSkipped, retryFailed };
}
