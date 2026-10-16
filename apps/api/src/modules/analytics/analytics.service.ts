import { INTERVIEW_STATUSES } from "@openapply/contracts/application";
import { singleton } from "tsyringe";
import { bucketPerDay, currentMonth, DAY_MS, startOfWeek } from "@/common/date/buckets";
import { PrismaClient } from "@/generated/prisma/client";
import { applicationOutcomes } from "./analytics.outcomes";

/** Statuses that mean the employer replied, whichever way it went. */
const RESPONDED_STATUSES = [...INTERVIEW_STATUSES, "offer", "rejected"] as const;
// What filling one application by hand takes; only used for the time-saved estimate.
const MINUTES_PER_APPLICATION = 10;
const STRONG_MATCH = 80;
const MEDIUM_MATCH = 60;

@singleton()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async stats(userId: string) {
    const weekStart = startOfWeek();
    const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);
    const month = currentMonth();

    const [
      queueDepth,
      weekSubmitted,
      lastWeekSubmitted,
      scoreRows,
      weekInterviewing,
      weekRejected,
      statusGroupRows,
      timelineRows,
      boardGroupRows,
      failReasonRows,
      outcomeRows,
      interviewEvents,
      attempted,
      submittedItems,
    ] = await Promise.all([
      this.prisma.workItem.count({ where: { userId, state: "queued" } }),
      this.prisma.application.count({
        where: { userId, appliedAt: { gte: weekStart } },
      }),
      this.prisma.application.count({
        where: { userId, appliedAt: { gte: lastWeekStart, lt: weekStart } },
      }),
      this.prisma.application.findMany({
        where: { userId, matchScore: { not: null } },
        select: { matchScore: true },
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
        where: { userId, appliedAt: { gte: month.start } },
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
      this.prisma.application.findMany({ where: { userId }, select: { id: true, status: true } }),
      this.prisma.applicationEvent.findMany({
        where: {
          application: { userId },
          kind: "status_change",
          toStatus: { in: [...INTERVIEW_STATUSES, "offer"] },
        },
        select: { applicationId: true },
        distinct: ["applicationId"],
      }),
      this.prisma.workItem.count({ where: { userId, kind: "application", attempts: { gt: 0 } } }),
      this.prisma.workItem.findMany({
        where: { userId, kind: "application", state: "submitted" },
        select: { id: true },
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
    // Application rows are recorded submissions; later outcomes do not undo that event.
    const totalSubmitted = totalApplications;
    const awaitingResponse = byStatus.get("applied") ?? 0;
    const totalInterviewing = sumOf(INTERVIEW_STATUSES);
    const totalOffers = byStatus.get("offer") ?? 0;
    const totalRejected = byStatus.get("rejected") ?? 0;
    const responded = sumOf(RESPONDED_STATUSES);

    const perDay = bucketPerDay(
      timelineRows.map((r) => r.appliedAt),
      month.start,
      month.days,
    );

    const topBoards = boardGroupRows
      .filter((r) => r.board)
      .map((r) => ({ board: r.board as string, count: r._count._all }));

    const topRejectReasons = failReasonRows
      .filter((r) => r.failReason)
      .map((r) => ({ reason: r.failReason as string, count: r._count._all }));

    const responseRatePct =
      awaitingResponse + responded > 0
        ? Math.round((responded / (awaitingResponse + responded)) * 100)
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
      lastWeek: { submitted: lastWeekSubmitted },
      matchScore: matchScoreSummary(scoreRows.map((row) => row.matchScore as number)),
      responseRatePct,
      statusBreakdown,
      perDay,
      topBoards,
      responses: responded,
      agent: await this.agentPerformance(
        userId,
        attempted,
        submittedItems.map((item) => item.id),
      ),
      topRejectReasons,
      outcomes: applicationOutcomes(
        outcomeRows,
        new Set(interviewEvents.map((event) => event.applicationId)),
      ),
    };

    return stats;
  }

  /** How the queue agent did: a submission with a single execution needed no one to step in. */
  private async agentPerformance(userId: string, attempted: number, submittedIds: string[]) {
    const [executions, runs, questions, openQuestions, accounts] = await Promise.all([
      submittedIds.length
        ? this.prisma.workExecution.findMany({
            where: { userId, workItemId: { in: submittedIds } },
            select: { workItemId: true, startedAt: true, finishedAt: true },
          })
        : [],
      this.prisma.workExecution.count({
        where: { userId, kind: "application", finishedAt: { not: null } },
      }),
      this.prisma.pilotQuestion.count({ where: { userId } }),
      this.prisma.pilotQuestion.count({ where: { userId, status: "open" } }),
      this.prisma.employerAccountAttempt.findMany({
        where: { userId, existingAccount: false, signupStartedAt: { not: null } },
        select: { authenticatedAt: true },
      }),
    ]);
    const runsPerItem = new Map<string, number>();
    let runMs = 0;
    for (const run of executions) {
      runsPerItem.set(run.workItemId, (runsPerItem.get(run.workItemId) ?? 0) + 1);
      if (run.finishedAt) runMs += run.finishedAt.getTime() - run.startedAt.getTime();
    }
    const submitted = submittedIds.length;
    return {
      attempted,
      submitted,
      automated: [...runsPerItem.values()].filter((count) => count === 1).length,
      minutesSaved: submitted * MINUTES_PER_APPLICATION,
      runs,
      // Every run for a submitted application counts, so retries make the average honest.
      avgRunSeconds: submitted ? Math.round(runMs / submitted / 1000) : null,
      questionsAsked: questions,
      questionsOpen: openQuestions,
      accountsCreated: accounts.length,
      accountsVerified: accounts.filter((account) => account.authenticatedAt).length,
    };
  }
}

export function matchScoreSummary(scores: number[]) {
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    average: scores.length ? Math.round(total / scores.length) : null,
    strong: scores.filter((score) => score >= STRONG_MATCH).length,
    medium: scores.filter((score) => score >= MEDIUM_MATCH && score < STRONG_MATCH).length,
    weak: scores.filter((score) => score < MEDIUM_MATCH).length,
  };
}
