import type { PrismaClient } from "@/generated/prisma/client";
import { hasKind, service } from "./fakes";
import { gatherApprovedJobs } from "./gather-jobs";
import { describe, expect, it } from "bun:test";

describe("AgendaService board.health", () => {
  // Newest-first apply outcomes for one board.
  const failed = (key: string) => ({
    campaignId: "c1",
    key,
    url: `https://x/${key}`,
    board: "linkedin",
    status: "failed",
    failReason: "captcha wall",
  });
  const applied = (key: string) => ({ ...failed(key), status: "applied", failReason: null });

  it("flags a board whose latest three applies failed, probing the newest failure", async () => {
    const agenda = await service({
      boardHealthJobs: [failed("a"), failed("b"), failed("c"), applied("d")],
    }).refresh("p1");
    const item = agenda.items.find((i) => i.kind === "board.health");
    expect(item?.payload).toEqual({
      board: "linkedin",
      consecutiveFailures: 3,
      recentFailReasons: ["captcha wall", "captcha wall", "captcha wall"],
      probeJob: { campaignId: "c1", jobKey: "a", url: "https://x/a" },
    });
  });

  it("does not flag a board whose streak a recent success broke", async () => {
    const agenda = await service({
      boardHealthJobs: [failed("a"), failed("b"), applied("c"), failed("d")],
    }).refresh("p1");
    expect(hasKind(agenda, "board.health")).toBe(false);
  });
});

describe("approved submission reservations", () => {
  it("excludes a canonical duplicate while keeping unstarted preparation on its own job", async () => {
    const rows = [
      {
        id: "duplicate",
        key: "duplicate",
        url: "http://www.example.test/job/1/?utm_source=repeat",
      },
      { id: "prepared", key: "prepared", url: "https://example.test/job/2" },
      { id: "fresh", key: "fresh", url: "https://example.test/job/3" },
    ].map((row) => ({
      ...row,
      campaignId: "c1",
      title: "Engineer",
      board: null,
      digest: null,
      matchScore: 90,
      company: "Acme",
      campaign: { config: {} },
    }));
    const reservations = [
      {
        jobId: null,
        canonicalUrl: "https://example.test/job/1",
        startedAt: new Date(),
        legacyOutcomeUnknown: false,
        receiptStoredAt: null,
        recordedAt: null,
      },
      {
        jobId: "prepared",
        canonicalUrl: "https://example.test/job/2",
        startedAt: null,
        legacyOutcomeUnknown: false,
        receiptStoredAt: null,
        recordedAt: null,
      },
    ];
    const db = {
      job: { findMany: async () => rows },
      submissionAttempt: {
        findFirst: async ({
          where,
        }: {
          where: { OR: { canonicalUrl?: string; jobId?: string }[] };
        }) =>
          reservations.find((attempt) =>
            where.OR.some(
              (query) =>
                query.canonicalUrl === attempt.canonicalUrl || query.jobId === attempt.jobId,
            ),
          ) ?? null,
        findMany: async () => [],
      },
    } as unknown as PrismaClient;
    expect((await gatherApprovedJobs(db, "u1")).map((job) => job.key)).toEqual([
      "prepared",
      "fresh",
    ]);
  });
});
