import { campaignConfigSchema } from "@jobpilot/contracts/campaign";
import type { AgendaPayload } from "@jobpilot/contracts/pilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { GATHER_CAP } from "./claims";

/** "I just applied" outreach still lands this long after the apply. */

const BOARD_HEALTH_SCAN = 500;
const BOARD_HEALTH_MIN_FAILURES = 3;
const FAIL_REASON_CAP = 3;

/** An approved or recently applied job, carrying what both apply and warm-intro items need. */
export interface AgendaJob {
  campaignId: string;
  key: string;
  title: string;
  url: string;
  board: string | null;
  digest: string | null;
  matchScore: number | null;
  company: string | null;
  resumeId?: string;
}

/** Approved jobs of in-progress campaigns, best match first. */
export async function gatherApprovedJobs(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaJob[]> {
  const rows = await prisma.job.findMany({
    where: { status: "approved", campaign: { userId, status: "in_progress" } },
    orderBy: { matchScore: "desc" },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      key: true,
      title: true,
      url: true,
      board: true,
      digest: true,
      matchScore: true,
      company: true,
      campaign: { select: { config: true } },
    },
  });
  return rows.map(({ campaign, ...job }) => ({
    ...job,
    resumeId: campaignConfigSchema.parse(campaign.config).resumeId,
  }));
}

/**
 * Strong approved matches plus recent applies. Applying outranks the intro, so without the applied
 * half the pool would drain before an intro ever fires.
 */

/** Names same-company contacts on each job, at any score: one read covers every job. */

/** Boards whose latest apply outcomes are a failure streak, longest streak first. */
export async function gatherBoardHealth(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"board.health">[]> {
  const rows = await prisma.job.findMany({
    where: { status: { in: ["applied", "failed"] }, board: { not: null }, campaign: { userId } },
    orderBy: { createdAt: "desc" },
    take: BOARD_HEALTH_SCAN,
    select: { campaignId: true, key: true, url: true, board: true, status: true, failReason: true },
  });

  const unhealthy: AgendaPayload<"board.health">[] = [];
  for (const [board, jobs] of Map.groupBy(rows, (row) => row.board ?? "")) {
    const firstSuccess = jobs.findIndex((job) => job.status !== "failed");
    const failed = firstSuccess === -1 ? jobs : jobs.slice(0, firstSuccess);
    if (failed.length < BOARD_HEALTH_MIN_FAILURES) continue;

    const probe = failed[0];
    unhealthy.push({
      board,
      consecutiveFailures: failed.length,
      recentFailReasons: failed
        .flatMap((job) => (job.failReason ? [job.failReason] : []))
        .slice(0, FAIL_REASON_CAP),
      probeJob: { campaignId: probe.campaignId, jobKey: probe.key, url: probe.url },
    });
  }
  return unhealthy.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}
