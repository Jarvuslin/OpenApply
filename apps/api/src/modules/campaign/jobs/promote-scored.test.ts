import type { FitAssessment } from "@openapply/contracts/scoring";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { SubmissionService } from "@/modules/application/submission.service";
import type { JobListingPublisher } from "@/modules/job-listing";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { FIT_ASSESSMENT } from "./fakes";
import { CampaignJobService } from "./job.service";
import { describe, expect, it } from "bun:test";

interface UpdateCall {
  where: { id: string; matchScore?: number; status: string; updatedAt: Date; campaign: unknown };
  data: {
    status?: string;
    skipReason?: string;
    fitAssessment?: unknown;
    matchScore?: number | null;
    matchReason?: string | null;
  };
}

function setup(assessment: FitAssessment | null, concurrentEdit = false) {
  const jobUpdates: UpdateCall[] = [];
  const updatedAt = new Date();
  const db = {
    $queryRaw: async () => [],
    submissionAttempt: { findFirst: async () => null, findMany: async () => [] },
    job: {
      findMany: async () => [
        {
          id: "id-a",
          campaignId: "c1",
          key: "a",
          url: "https://example.test/a",
          company: "Example",
          updatedAt,
        },
      ],
      updateManyAndReturn: async (args: UpdateCall) => {
        jobUpdates.push(args);
        if (concurrentEdit) return [];
        return [{ id: "id-a", campaignId: "c1", key: "a", ...args.data }];
      },
      groupBy: async () => [],
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const scoring = {
    currentAssessment: async (_userId: string, _input: unknown, tx: unknown) => {
      expect(tx).toBe(db);
      return assessment;
    },
  } as unknown as ScoringService;
  return {
    service: new CampaignJobService(
      db as unknown as PrismaClient,
      { publishInBackground: () => undefined } as unknown as JobListingPublisher,
      {} as SubmissionService,
      scoring,
    ),
    jobUpdates,
    updatedAt,
  };
}

const candidate = { key: "a", matchScore: 99, threshold: 50 };

describe("CampaignJobService.promoteScoredJobs", () => {
  it("uses current verified evidence instead of the candidate's arbitrary score", async () => {
    const state = setup({ ...FIT_ASSESSMENT, score: 30 });
    await state.service.promoteScoredJobs("u1", "c1", "auto_apply", [candidate]);
    expect(state.jobUpdates).toHaveLength(1);
    expect(state.jobUpdates[0]).toMatchObject({
      where: {
        status: "pending",
        matchScore: 30,
        updatedAt: state.updatedAt,
        campaign: { userId: "u1", status: "in_progress", source: { in: ["auto_apply", "apply"] } },
      },
      data: { status: "skipped", skipReason: "Below minimum match score (30 < 50)" },
    });
  });

  it("clears legacy or stale scores and leaves the job pending for assessment", async () => {
    const state = setup(null);
    await state.service.promoteScoredJobs("u1", "c1", "auto_apply", [candidate]);
    expect(state.jobUpdates[0]?.data).toEqual({
      fitAssessment: Prisma.DbNull,
      matchScore: null,
      matchReason: null,
    });
  });

  it("excludes an unwanted role even when resume fit is high", async () => {
    const state = setup({
      ...FIT_ASSESSMENT,
      roleMatch: { ...FIT_ASSESSMENT.roleMatch, relevance: "outside_preferences" },
    });
    await state.service.promoteScoredJobs("u1", "c1", "auto_apply", [candidate]);
    expect(state.jobUpdates[0]?.data).toEqual({
      status: "skipped",
      skipReason: "Outside saved desired roles",
    });
  });

  it("allows known-role evidence uncertainty to reach the application worker's review", async () => {
    const state = setup({ ...FIT_ASSESSMENT, verdict: "needs_review" });
    await state.service.promoteScoredJobs("u1", "c1", "auto_apply", [candidate]);
    expect(state.jobUpdates[0]?.data).toEqual({ status: "approved" });
  });

  it("keeps an unclear role pending even without role restrictions", async () => {
    const state = setup({
      ...FIT_ASSESSMENT,
      verdict: "needs_review",
      roleMatch: { ...FIT_ASSESSMENT.roleMatch, family: "Unclear", relevance: "not_restricted" },
    });
    await state.service.promoteScoredJobs("u1", "c1", "auto_apply", [candidate]);
    expect(state.jobUpdates).toHaveLength(0);
  });

  it("promotes verified pasted links and guards concurrent posting edits", async () => {
    const state = setup(FIT_ASSESSMENT, true);
    await state.service.promoteScoredJobs("u1", "c1", "apply", [candidate]);
    expect(state.jobUpdates[0]).toMatchObject({
      where: { updatedAt: state.updatedAt, matchScore: 90 },
      data: { status: "approved" },
    });
  });
});
