import type { ApplicationStatus } from "@openapply/contracts/application";
import type { WorkItem, WorkState } from "@openapply/contracts/work-queue";
import { DAY_MS } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { AnalyticsService, matchScoreSummary } from "./analytics.service";
import { describe, expect, it } from "bun:test";

interface ApplicationRow {
  userId: string;
  status: ApplicationStatus;
  appliedAt: Date;
  matchScore?: number;
}

interface WorkRow {
  userId: string;
  state: WorkState;
  kind: WorkItem["kind"];
  jobStatus?: string;
}

function fixture(rows: ApplicationRow[], work: WorkRow[] = [], legacyQueuedJobs = 0) {
  const matches = (where: {
    userId: string;
    status?: string;
    appliedAt?: { gte: Date; lt?: Date };
    matchScore?: unknown;
  }) =>
    rows.filter(
      (row) =>
        row.userId === where.userId &&
        (!where.matchScore || row.matchScore != null) &&
        (!where.status || row.status === where.status) &&
        (!where.appliedAt || row.appliedAt >= where.appliedAt.gte) &&
        (!where.appliedAt?.lt || row.appliedAt < where.appliedAt.lt),
    );
  const db = {
    application: {
      count: async ({ where }: { where: Parameters<typeof matches>[0] }) => matches(where).length,
      findMany: async ({ where }: { where: Parameters<typeof matches>[0] }) => matches(where),
      groupBy: async ({ by, where }: { by: string[]; where: { userId: string } }) => {
        if (by[0] !== "status") return [];
        const counts = new Map<string, number>();
        for (const row of matches(where)) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        return [...counts].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
    },
    applicationEvent: { count: async () => 0, findMany: async () => [] },
    workItem: {
      count: async ({ where }: { where: { userId: string; state: string } }) =>
        work.filter((row) => row.userId === where.userId && row.state === where.state).length,
      findMany: async () => [],
    },
    job: { count: async () => legacyQueuedJobs, groupBy: async () => [] },
    workExecution: { findMany: async () => [], count: async () => 0 },
    pilotQuestion: { count: async () => 0 },
    employerAccountAttempt: { findMany: async () => [] },
  } as unknown as PrismaClient;
  return new AnalyticsService(db);
}

describe("AnalyticsService submission counts", () => {
  it("keeps a recorded submission in its original week after every later outcome", async () => {
    const row: ApplicationRow = { userId: "owner", status: "applied", appliedAt: new Date() };
    const service = fixture([row]);
    for (const status of [
      "applied",
      "screening",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
    ] as const) {
      row.status = status;
      const stats = await service.stats("owner");
      expect(stats.totals.submitted).toBe(1);
      expect(stats.thisWeek.submitted).toBe(1);
      expect(stats.perDay.reduce((sum, day) => sum + day.count, 0)).toBe(1);
    }
  });

  it("counts the submission date, not the current status, and keeps users isolated", async () => {
    const service = fixture([
      { userId: "owner", status: "offer", appliedAt: new Date() },
      { userId: "owner", status: "applied", appliedAt: new Date(Date.now() - 14 * DAY_MS) },
      { userId: "other", status: "rejected", appliedAt: new Date() },
    ]);
    const stats = await service.stats("owner");
    expect(stats.totals.submitted).toBe(2);
    expect(stats.thisWeek.submitted).toBe(1);
    expect(stats.responseRatePct).toBe(50);
  });

  it("counts the owned canonical queue despite divergent legacy job states", async () => {
    const stats = await fixture(
      [],
      [
        { userId: "owner", state: "queued", kind: "application", jobStatus: "approved" },
        { userId: "owner", state: "queued", kind: "pilot_task" },
        { userId: "owner", state: "needs_user", kind: "application", jobStatus: "queued" },
        { userId: "owner", state: "paused", kind: "application", jobStatus: "queued" },
        { userId: "owner", state: "preparing", kind: "application", jobStatus: "applying" },
        { userId: "owner", state: "submitted", kind: "application", jobStatus: "applied" },
        { userId: "other", state: "queued", kind: "application", jobStatus: "queued" },
      ],
      7,
    ).stats("owner");
    expect(stats.totals.queueDepth).toBe(2);
    expect(stats.totals.submitted).toBe(0);
    expect(stats.thisWeek.submitted).toBe(0);
    expect(stats.responseRatePct).toBe(0);
  });

  it("does not count old queued jobs with no canonical work", async () => {
    expect((await fixture([], [], 5).stats("owner")).totals.queueDepth).toBe(0);
  });
});

describe("AnalyticsService agent performance", () => {
  it("counts automated submissions, run time, questions and created accounts", async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute));
    const db = {
      workExecution: {
        findMany: async () => [
          { workItemId: "a", startedAt: at(0), finishedAt: at(4) },
          { workItemId: "b", startedAt: at(10), finishedAt: at(12) },
          { workItemId: "b", startedAt: at(20), finishedAt: at(22) },
        ],
        count: async () => 4,
      },
      pilotQuestion: {
        count: async ({ where }: { where: { status?: string } }) => (where.status ? 1 : 3),
      },
      employerAccountAttempt: {
        findMany: async () => [{ authenticatedAt: at(30) }, { authenticatedAt: null }],
      },
    } as unknown as PrismaClient;
    const service = new AnalyticsService(db) as unknown as {
      agentPerformance: (userId: string, attempted: number, ids: string[]) => Promise<unknown>;
    };
    expect(await service.agentPerformance("owner", 3, ["a", "b"])).toEqual({
      attempted: 3,
      submitted: 2,
      automated: 1,
      minutesSaved: 20,
      runs: 4,
      avgRunSeconds: 240,
      questionsAsked: 3,
      questionsOpen: 1,
      accountsCreated: 2,
      accountsVerified: 1,
    });
  });
});

describe("AnalyticsService weekly and match score", () => {
  it("compares this week with the seven days before it", async () => {
    const stats = await fixture([
      { userId: "owner", status: "applied", appliedAt: new Date() },
      { userId: "owner", status: "applied", appliedAt: new Date(Date.now() - 9 * DAY_MS) },
      { userId: "owner", status: "applied", appliedAt: new Date(Date.now() - 20 * DAY_MS) },
    ]).stats("owner");
    expect(stats.thisWeek.submitted).toBe(1);
    expect(stats.lastWeek.submitted).toBe(1);
  });

  it("buckets scores into strong, medium and weak", () => {
    expect(matchScoreSummary([85, 80, 79, 60, 59])).toEqual({
      average: 73,
      strong: 2,
      medium: 2,
      weak: 1,
    });
    expect(matchScoreSummary([]).average).toBeNull();
  });
});
