import type { FitAssessment } from "@openapply/contracts/scoring";
import type { Prisma } from "@/generated/prisma/client";
import { discoveryBlockedReason, reserveDiscoveryApplication } from "./discovery-guard";
import { FIT_ASSESSMENT } from "./fakes";
import { expect, it } from "bun:test";

const config = {
  minScore: 20,
  discovery: {
    phase: "complete",
    intent: "apply",
    searches: [],
    sources: [],
    completedAt: new Date().toISOString(),
    reason: "Bounded searches finished",
  },
};
const matched = {
  status: "matched" as const,
  explanation: "Matches saved preference",
  evidence: [],
};
const assessment: FitAssessment = {
  ...FIT_ASSESSMENT,
  score: 20,
  preferenceChecks: {
    level: matched,
    location: matched,
    workMode: matched,
    employmentType: matched,
    eligibility: [],
  },
};

it("never promotes a collecting list or unscored candidate", () => {
  expect(
    discoveryBlockedReason(
      { ...config, discovery: { ...config.discovery, phase: "collecting" } },
      assessment,
    ),
  ).toContain("Finish collecting");
  expect(discoveryBlockedReason(config, null)).toContain("current original");
});
it("keeps previews inert and allows a low score when it meets the saved threshold", () => {
  expect(
    discoveryBlockedReason(
      { ...config, discovery: { ...config.discovery, intent: "preview" } },
      assessment,
    ),
  ).toContain("preview");
  expect(discoveryBlockedReason(config, assessment)).toBeNull();
  expect(discoveryBlockedReason({}, null)).toBeNull();
});
it("separates preference and hard eligibility blockers from soft skill gaps", () => {
  expect(discoveryBlockedReason(config, { ...assessment, preferenceChecks: undefined })).toContain(
    "separate preference",
  );
  expect(
    discoveryBlockedReason(config, {
      ...assessment,
      preferenceChecks: {
        ...assessment.preferenceChecks!,
        level: { ...matched, status: "mismatch" },
      },
    }),
  ).toContain("preference");
  expect(
    discoveryBlockedReason(config, {
      ...assessment,
      preferenceChecks: {
        ...assessment.preferenceChecks!,
        eligibility: [
          {
            requirement: "Work authorization",
            status: "unknown",
            explanation: "Unconfirmed",
            evidence: [],
          },
        ],
      },
    }),
  ).toContain("eligibility");
  expect(discoveryBlockedReason(config, { ...assessment, gaps: ["Rust not shown"] })).toBeNull();
});

it("rechecks role and refuses a missing list threshold at final submission", () => {
  expect(discoveryBlockedReason({ ...config, minScore: undefined }, assessment)).toContain(
    "minimum match",
  );
  expect(
    discoveryBlockedReason(config, {
      ...assessment,
      roleMatch: { ...assessment.roleMatch, relevance: "outside_preferences" },
    }),
  ).toContain("outside saved");
  expect(
    discoveryBlockedReason(config, {
      ...assessment,
      roleMatch: { ...assessment.roleMatch, relevance: "unclear" },
    }),
  ).toContain("Resolve");
});

it("serializes the campaign before counting both active applications and begun/unknown parked attempts", async () => {
  const calls: string[] = [];
  const db = {
    campaign: {
      updateMany: async () => {
        calls.push("lock");
        return { count: 1 };
      },
    },
    job: {
      count: async ({ where }: { where: unknown }) => {
        calls.push("count");
        expect(where).toMatchObject({
          campaignId: "c1",
          id: { not: "j1" },
          OR: [
            { status: { in: ["applying", "applied"] } },
            {
              submissionAttempt: {
                is: { OR: [{ startedAt: { not: null } }, { legacyOutcomeUnknown: true }] },
              },
            },
          ],
        });
        return 1;
      },
    },
  } as unknown as Prisma.TransactionClient;
  await expect(
    reserveDiscoveryApplication(
      db,
      "u1",
      { id: "j1", campaignId: "c1" },
      { ...config, maxApplications: 1 },
    ),
  ).rejects.toThrow("application limit");
  expect(calls).toEqual(["lock", "count"]);
});
