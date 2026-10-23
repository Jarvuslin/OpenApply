import type { PrismaClient } from "@/generated/prisma/client";
import type { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { SUBMISSION_NOT_STARTED } from "@/modules/campaign/jobs/submission-guard";
import { promoteScoredPendingJobs, runExpiry } from "./maintenance";
import { describe, expect, it } from "bun:test";

type Write = { where: Record<string, unknown>; data: Record<string, unknown> };

function expiryDb(options: { expiredQuestions?: Record<string, unknown>[] }) {
  const writes = { jobs: [] as Write[], questions: [] as Write[] };
  const db = {
    pilotQuestion: {
      findMany: async () => options.expiredQuestions ?? [],
      updateMany: async (a: Write) => {
        writes.questions.push(a);
        return { count: 1 };
      },
    },
    job: {
      updateMany: async (a: Write) => {
        writes.jobs.push(a);
        return { count: 1 };
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const run = () => runExpiry(db as unknown as PrismaClient, "u1", new Date());
  const jobWrite = (status: string) => writes.jobs.find((w) => w.where.status === status);
  return { run, writes, jobWrite };
}

describe("runExpiry", () => {
  it("skips the job an expired question parked", async () => {
    const db = expiryDb({
      expiredQuestions: [
        { id: "q1", subjectType: "job", subjectId: "22222222-2222-4222-8222-222222222222" },
      ],
    });
    await db.run();
    expect(db.writes.questions[0]).toMatchObject({ data: { status: "expired" } });
    expect(db.jobWrite("needs_user")).toMatchObject({
      where: {
        id: { in: ["22222222-2222-4222-8222-222222222222"] },
        workItem: null,
        AND: [SUBMISSION_NOT_STARTED],
      },
      data: { status: "skipped" },
    });
  });

  it("leaves stranded applying jobs to durable queue recovery", async () => {
    const db = expiryDb({});
    await db.run();
    expect(db.writes.jobs.some((write) => write.where.status === "applying")).toBe(false);
  });

  it("skips stale approved jobs in pilot campaigns only", async () => {
    const db = expiryDb({});
    await db.run();
    expect(db.jobWrite("approved")).toMatchObject({
      where: {
        campaign: { userId: "u1", createdBy: "pilot" },
        createdAt: { lt: expect.any(Date) },
        AND: [SUBMISSION_NOT_STARTED],
      },
      data: { status: "skipped", skipReason: "Posting went stale before the pilot applied." },
    });
  });
});

describe("promoteScoredPendingJobs", () => {
  const scored = (matchScore: number, config: Record<string, unknown> = {}) => ({
    campaignId: "c1",
    key: "jobkey",
    matchScore,
    campaign: { config, source: "auto_apply" },
  });

  const promote = async (rows: Record<string, unknown>[]) => {
    const calls: unknown[][] = [];
    const prisma = { job: { findMany: async () => rows } } as unknown as PrismaClient;
    const campaignJobs = {
      promoteScoredJobs: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as CampaignJobService;
    await promoteScoredPendingJobs(prisma, campaignJobs, "p1", 60);
    return calls;
  };

  it("settles each campaign's jobs against the supplied profile threshold", async () => {
    expect(await promote([scored(75)])).toEqual([
      ["p1", "c1", "auto_apply", [{ key: "jobkey", matchScore: 75, threshold: 60 }]],
    ]);
  });

  it("prefers the campaign's own minScore", async () => {
    const [call] = await promote([scored(75, { minScore: 80 })]);
    expect(call[3]).toEqual([{ key: "jobkey", matchScore: 75, threshold: 80 }]);
  });
});
