import { INTERVIEW_STATUSES } from "@openapply/contracts/application";
import { singleton } from "tsyringe";
import { bucketPerDay, startOfTimeline, startOfWeek } from "@/common/date/buckets";
import { PrismaClient } from "@/generated/prisma/client";

/** Statuses that mean the employer replied, whichever way it went. */
const RESPONDED_STATUSES = [...INTERVIEW_STATUSES, "offer", "rejected"] as const;

/** Statuses that mean the message left the outbox. */

@singleton()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async stats(userId: string) {
    const weekStart = startOfWeek();
    const timelineStart = startOfTimeline();

    const [
      queueDepth,
      weekSubmitted,
      weekInterviewing,
      weekRejected,
      statusGroupRows,
      timelineRows,
      boardGroupRows,
      failReasonRows,
    ] = await Promise.all([
      this.prisma.job.count({ where: { status: "queued", campaign: { userId } } }),
      this.prisma.application.count({
        where: { userId, status: "applied", appliedAt: { gte: weekStart } },
      }),
      // Counted from the transition: an application submitted last month can start interviewing today.
      this.prisma.applicationEvent.count({
        where: {
          application: { userId },
          kind: "status_change",
          toStatus: { in: [...INTERVIEW_STATUSES] },
          createdAt: { gte: weekStart },
        },
      }),
      this.prisma.applicationEvent.count({
        where: {
          application: { userId },
          kind: "status_change",
          toStatus: "rejected",
          createdAt: { gte: weekStart },
        },
      }),
      this.prisma.application.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.application.findMany({
        where: { userId, appliedAt: { gte: timelineStart } },
        select: { appliedAt: true },
      }),
      this.prisma.application.groupBy({
        by: ["board"],
        where: { userId, board: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
      this.prisma.job.groupBy({
        by: ["failReason"],
        where: { failReason: { not: null }, campaign: { userId } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
    ]);

    const statusBreakdown = statusGroupRows.map((r) => ({
      status: r.status,
      count: r._count._all,
    }));

    // Every application total comes off this one groupBy; a per-status count query would re-read the same rows.
    const byStatus = new Map(statusBreakdown.map((r) => [r.status as string, r.count]));
    const sumOf = (statuses: readonly string[]): number =>
      statuses.reduce((n, status) => n + (byStatus.get(status) ?? 0), 0);

    const totalApplications = statusBreakdown.reduce((n, r) => n + r.count, 0);
    const totalSubmitted = byStatus.get("applied") ?? 0;
    const totalInterviewing = sumOf(INTERVIEW_STATUSES);
    const totalOffers = byStatus.get("offer") ?? 0;
    const totalRejected = byStatus.get("rejected") ?? 0;
    const responded = sumOf(RESPONDED_STATUSES);

    const perDay = bucketPerDay(
      timelineRows.map((r) => r.appliedAt),
      timelineStart,
    );

    const topBoards = boardGroupRows
      .filter((r) => r.board)
      .map((r) => ({ board: r.board as string, count: r._count._all }));

    const topRejectReasons = failReasonRows
      .filter((r) => r.failReason)
      .map((r) => ({ reason: r.failReason as string, count: r._count._all }));

    const responseRatePct =
      totalSubmitted + responded > 0
        ? Math.round((responded / (totalSubmitted + responded)) * 100)
        : 0;

    const stats = {
      totals: {
        applications: totalApplications,
        submitted: totalSubmitted,
        interviewing: totalInterviewing,
        offers: totalOffers,
        rejected: totalRejected,
        queueDepth,
      },
      thisWeek: {
        submitted: weekSubmitted,
        interviewing: weekInterviewing,
        rejected: weekRejected,
      },
      responseRatePct,
      statusBreakdown,
      perDay,
      topBoards,
      topRejectReasons,
    };

    return stats;
  }
}
