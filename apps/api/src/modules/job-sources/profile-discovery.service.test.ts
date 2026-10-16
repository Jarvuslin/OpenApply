import type { PrismaClient } from "@/generated/prisma/client";
import { FIT_ASSESSMENT } from "@/modules/campaign/jobs/fakes";
import type { OriginalResumeSource } from "@/modules/scoring/original-source";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { ProfileDiscoveryService } from "./profile-discovery.service";
import { expect, it } from "bun:test";

const sourceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const baseConfig = {
  resumeId: sourceId,
  minScore: 20,
  maxJobs: 100,
  maxApplications: 5,
  discovery: {
    phase: "collecting",
    intent: "preview",
    searches: [],
    sources: [],
    completedAt: null,
    reason: null,
  },
};
function setup(
  jobs: Record<string, unknown>[] = [],
  assessment: unknown = null,
  initialConfig: unknown = baseConfig,
) {
  let saved: Record<string, unknown> = {
    campaignId,
    userId: "u1",
    query: "Profile job list",
    source: "search",
    status: "in_progress",
    updatedAt: new Date(),
    config: initialConfig,
  };
  const db = {
    user: {
      findUniqueOrThrow: async () => ({
        primaryResumeId: "other",
        jobPreferences: {
          roles: [],
          levels: ["Entry"],
          yearsExperience: null,
          workModes: [],
          employmentTypes: [],
        },
        preferredLocations: '["Toronto"]',
        autoApply: { minMatchScore: 20 },
      }),
    },
    resume: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        sourceFilename: "original.pdf",
        content: {
          basics: { name: "Applicant" },
          experience: [{ company: "Acme", title: "Software Engineer", start: "2024", bullets: [] }],
        },
      }),
    },
    campaign: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        saved = { ...saved, ...data };
        return saved;
      },
      findFirst: async () => saved,
      updateMany: async ({ where }: { where: { jobs?: unknown } }) => ({
        count: where.jobs && jobs.length ? 0 : 1,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        saved = { ...saved, ...data };
        return saved;
      },
    },
    job: { findMany: async () => jobs },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  return {
    service: new ProfileDiscoveryService(
      db as unknown as PrismaClient,
      { currentAssessment: async () => assessment } as unknown as ScoringService,
      {
        read: async () => ({ text: "Applicant Software Engineer", sha256: "a".repeat(64) }),
      } as OriginalResumeSource,
    ),
    saved: () => saved,
  };
}

it("keeps an explicit original resume, saved low threshold, and inferred query separate from restrictions", async () => {
  const state = setup();
  const result = await state.service.create("u1", {
    resumeId: sourceId,
    intent: "preview",
    maxJobs: 100,
    maxApplications: 5,
  });
  expect(result.resumeId).toBe(sourceId);
  expect(result.minScore).toBe(20);
  expect(result.searches).toEqual([
    { query: "entry level Software Engineer", location: "Toronto" },
  ]);
  expect(state.saved()).toMatchObject({
    source: "search",
    config: { discovery: { intent: "preview", phase: "collecting" } },
  });
});
it("does not complete a resolved unscored list or legacy assessment missing preference checks", async () => {
  await expect(
    setup([{ key: "a", status: "pending", description: "Full posting" }]).service.complete(
      "u1",
      campaignId,
      "Finished search",
    ),
  ).rejects.toThrow("every resolved");
  await expect(
    setup(
      [{ key: "a", status: "pending", description: "Full posting" }],
      FIT_ASSESSMENT,
    ).service.complete("u1", campaignId, "Finished search"),
  ).rejects.toThrow("preferences");
});
it("reports unavailable descriptions and explicit blockers without counting them application-ready", async () => {
  const state = setup([
    { key: "a", status: "queued", description: "", retryNotes: "Source description unavailable" },
    {
      key: "b",
      status: "needs_user",
      description: "Partial posting",
      retryNotes: "Employer posting cannot be opened",
    },
  ]);
  const result = await state.service.complete("u1", campaignId, "Checked bounded sources");
  expect(result.coverage.phase).toBe("complete");
  expect(result.coverage.reason).toContain("2 candidate(s) remain unassessed");
});
it("does not authorize applying to an unfinished preview", async () => {
  await expect(setup().service.apply("u1", campaignId, 5)).rejects.toThrow("Finish collecting");
});

it("initializes only an empty legacy campaign and never replaces the selected original", async () => {
  const initial = { resumeId: sourceId, minScore: 20 };
  await expect(
    setup([{ key: "existing" }], null, initial).service.initialize("u1", campaignId, {
      intent: "apply",
    }),
  ).rejects.toThrow("empty campaign");
  await expect(
    setup([], null, initial).service.initialize("u1", campaignId, {
      intent: "apply",
      resumeId: campaignId,
    }),
  ).rejects.toThrow("replace");
  const result = await setup([], null, initial).service.initialize("u1", campaignId, {
    intent: "apply",
  });
  expect(result).toMatchObject({
    resumeId: sourceId,
    minScore: 20,
    coverage: { intent: "apply", phase: "collecting" },
  });
});
