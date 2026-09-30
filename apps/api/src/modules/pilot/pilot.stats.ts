import { DAY_MS, startOfDay } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { isCrash } from "./agenda/claims";
import { classifySkipReason, type SkipBucket } from "./skip-reasons";

/** Claims older than a week describe a version of the agent you are no longer running. */
const COST_WINDOW_MS = 7 * DAY_MS;

export function countAppliedToday(
  prisma: Pick<PrismaClient, "application">,
  userId: string,
  now: Date,
): Promise<number> {
  return prisma.application.count({ where: { userId, appliedAt: { gte: startOfDay(now) } } });
}

export function countSentToday(
  prisma: Pick<PrismaClient, "networkingMessage">,
  userId: string,
  now: Date,
): Promise<number> {
  return prisma.networkingMessage.count({ where: { userId, sentAt: { gte: startOfDay(now) } } });
}

/** Today's skipped and failed jobs, with skip reasons bucketed most frequent first. */
export async function countTodayOutcomes(
  prisma: Pick<PrismaClient, "job">,
  userId: string,
  now: Date,
) {
  const where = { campaign: { userId }, updatedAt: { gte: startOfDay(now) } };
  const [byStatus, skipped] = await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      where: { ...where, status: { in: ["skipped", "failed"] } },
      _count: { _all: true },
    }),
    // Tens of rows a day, and the bucketing can't run in SQL.
    prisma.job.findMany({
      where: { ...where, status: "skipped", skipReason: { not: null } },
      select: { skipReason: true },
    }),
  ]);

  const counts = new Map<SkipBucket, number>();
  for (const { skipReason } of skipped) {
    const bucket = classifySkipReason(skipReason ?? "");
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const countOf = (status: "skipped" | "failed") =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;

  return {
    skipped: countOf("skipped"),
    failed: countOf("failed"),
    skipReasons: [...counts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Where the week's cycles went, by agenda kind, heaviest first. A released claim already brackets
 * one run of one kind, so its wall clock stands in for token spend without a telemetry write.
 */
export async function costByKind(
  prisma: Pick<PrismaClient, "pilotClaim">,
  userId: string,
  now: Date,
) {
  const claims = await prisma.pilotClaim.findMany({
    where: {
      userId,
      releasedAt: { not: null },
      grantedAt: { gte: new Date(now.getTime() - COST_WINDOW_MS) },
    },
    // Uncapped: any cap short enough to matter would quietly shorten the week being reported.
    select: { kind: true, grantedAt: true, releasedAt: true, outcome: true },
  });

  const released = claims.flatMap(({ releasedAt, ...claim }) =>
    releasedAt ? [{ ...claim, ms: releasedAt.getTime() - claim.grantedAt.getTime() }] : [],
  );
  return [...Map.groupBy(released, (run) => run.kind)]
    .map(([kind, runs]) => {
      const durations = runs.map((run) => run.ms).sort((a, b) => a - b);
      return {
        kind,
        runs: runs.length,
        medianMs: median(durations),
        totalMs: durations.reduce((sum, ms) => sum + ms, 0),
        failed: runs.filter((run) => run.outcome === "failed").length,
        abandoned: runs.filter((run) => isCrash(run.outcome)).length,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
}
