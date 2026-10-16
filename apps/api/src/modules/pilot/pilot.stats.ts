import { startOfDay } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { classifySkipReason, type SkipBucket } from "./skip-reasons";

export function countAppliedToday(
  prisma: Pick<PrismaClient, "application">,
  userId: string,
  now: Date,
): Promise<number> {
  return prisma.application.count({ where: { userId, appliedAt: { gte: startOfDay(now) } } });
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
