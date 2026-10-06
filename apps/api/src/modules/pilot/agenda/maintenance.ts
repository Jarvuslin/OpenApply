import { CAMPAIGN_JOB_ACTIVE_STATUSES, campaignConfigSchema } from "@jobpilot/contracts/campaign";
import { DAY_MS } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { PROMOTABLE_SOURCES, publishCampaignStatus } from "@/modules/campaign/campaign.utils";
import type { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import type { PilotJournalService } from "../journal.service";
import { SERVER_SKIP_REASONS } from "../skip-reasons";
import { GATHER_CAP, parseJobRef, parseJobSubject, revertApplyingJobs } from "./claims";

/** An `applying` job with no open claim and no update for this long lost its driver. */
const STALE_APPLYING_MS = 30 * 60 * 1000;
/** A week-long pause would otherwise wake to dead postings ranked above everything else. */
const APPROVED_JOB_STALE_MS = 7 * DAY_MS;
/** Recent job activity means someone may be mid-session on the campaign. */
const FINALIZE_IDLE_MS = 10 * 60 * 1000;
const MAX_OPEN_APPLY_CLAIMS = 20;

/** Releases expired claims and questions and returns what they held to a workable state. */
export async function runExpiry(prisma: PrismaClient, userId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const expiredClaims = await tx.pilotClaim.findMany({
      where: { userId, releasedAt: null, expiresAt: { lt: now } },
      take: GATHER_CAP,
      select: { id: true, kind: true, payload: true },
    });
    if (expiredClaims.length > 0) {
      await tx.pilotClaim.updateMany({
        where: { id: { in: expiredClaims.map((claim) => claim.id) }, releasedAt: null },
        data: { releasedAt: now, outcome: "expired" },
      });
      const jobs = expiredClaims
        .filter((claim) => claim.kind === "job.apply")
        .map((claim) => parseJobRef(claim.payload));
      await revertApplyingJobs(tx, userId, jobs);
    }

    // A crashed terminal apply takes no claim, so its job would stay `applying` and block finalize.
    const openApplyClaims = await tx.pilotClaim.findMany({
      where: { userId, kind: "job.apply", releasedAt: null, expiresAt: { gte: now } },
      take: MAX_OPEN_APPLY_CLAIMS,
      select: { payload: true },
    });
    await tx.job.updateMany({
      where: {
        status: "applying",
        campaign: { userId },
        updatedAt: { lt: new Date(now.getTime() - STALE_APPLYING_MS) },
        NOT: openApplyClaims.map((claim) => parseJobRef(claim.payload)),
      },
      data: { status: "approved" },
    });

    // Pilot campaigns only: a user's own queue is theirs to clear.
    await tx.job.updateMany({
      where: {
        status: "approved",
        campaign: { userId, createdBy: "pilot" },
        createdAt: { lt: new Date(now.getTime() - APPROVED_JOB_STALE_MS) },
      },
      data: { status: "skipped", skipReason: SERVER_SKIP_REASONS.wentStale },
    });

    const expiredQuestions = await tx.pilotQuestion.findMany({
      where: { userId, status: "open", expiresAt: { not: null, lt: now } },
      take: GATHER_CAP,
      select: { id: true, subjectType: true, subjectId: true },
    });
    if (expiredQuestions.length === 0) return;

    await tx.pilotQuestion.updateMany({
      where: { id: { in: expiredQuestions.map((question) => question.id) }, status: "open" },
      data: { status: "expired" },
    });
    const parkedJobs = expiredQuestions.flatMap((question) =>
      question.subjectType === "job" && question.subjectId
        ? [parseJobSubject(question.subjectId)]
        : [],
    );
    if (parkedJobs.length === 0) return;

    await tx.job.updateMany({
      where: {
        status: "needs_user",
        campaign: { userId },
        OR: parkedJobs,
      },
      data: { status: "skipped", skipReason: SERVER_SKIP_REASONS.unanswered },
    });
  });
}

/**
 * Settles scored pending jobs against their campaign's `minScore`, so they reach the agenda (or
 * skip) now instead of waiting for the next discovery run to re-fire.
 */
export async function promoteScoredPendingJobs(
  prisma: PrismaClient,
  campaignJobs: CampaignJobService,
  userId: string,
  fallbackMinScore: number,
): Promise<void> {
  const rows = await prisma.job.findMany({
    where: {
      status: "pending",
      matchScore: { not: null },
      campaign: { userId, status: "in_progress", source: { in: PROMOTABLE_SOURCES } },
    },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      key: true,
      matchScore: true,
      campaign: { select: { config: true, source: true } },
    },
  });

  for (const [campaignId, jobs] of Map.groupBy(rows, (row) => row.campaignId)) {
    const { config, source } = jobs[0].campaign;
    const threshold = campaignConfigSchema.parse(config).minScore ?? fallbackMinScore;
    const candidates = jobs.map((job) => ({
      key: job.key,
      matchScore: job.matchScore ?? 0,
      threshold,
    }));
    await campaignJobs.promoteScoredJobs(userId, campaignId, source, candidates);
  }
}

/**
 * Completes in-progress campaigns with no active work left. A bare status flip needs no agent
 * cycle, and as the lowest-priority agenda item it used to be starved forever.
 */
export async function finalizeIdleCampaigns(
  prisma: PrismaClient,
  journal: PilotJournalService,
  userId: string,
  now: Date,
): Promise<void> {
  const idle = await prisma.campaign.findMany({
    where: {
      userId,
      status: "in_progress",
      jobs: { none: { updatedAt: { gt: new Date(now.getTime() - FINALIZE_IDLE_MS) } } },
      source: { in: ["search", "auto_apply", "apply"] },
      NOT: { jobs: { some: { status: { in: [...CAMPAIGN_JOB_ACTIVE_STATUSES] } } } },
    },
    select: { campaignId: true, query: true, source: true },
  });

  const results = await Promise.all(
    idle.map((campaign) =>
      // Guarded on status, so a concurrent transition wins over the sweep.
      prisma.campaign.updateMany({
        where: { campaignId: campaign.campaignId, userId, status: "in_progress" },
        data: {
          status: "completed",
          statusActor: "pilot",
          statusReason: "No active work remaining.",
          completedAt: now,
        },
      }),
    ),
  );
  const completed = idle.filter((_, index) => results[index].count > 0);
  if (completed.length === 0) return;

  for (const campaign of completed) publishCampaignStatus(userId, campaign, "completed");
  await journal.appendJournal(userId, {
    entries: completed.map((campaign) => ({
      kind: "action" as const,
      subjectType: "campaign",
      subjectId: campaign.campaignId,
      summary: `Completed campaign '${campaign.query}' - no active work remaining.`,
    })),
  });
}
