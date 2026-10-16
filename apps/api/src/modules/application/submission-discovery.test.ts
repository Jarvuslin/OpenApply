import type { CampaignConfig } from "@openapply/contracts/campaign";
import type { FitAssessment } from "@openapply/contracts/scoring";
import { FIT_ASSESSMENT } from "@/modules/campaign/jobs/fakes";
import {
  ATTEMPT_CAMPAIGN,
  ATTEMPT_USER,
  attemptFixture,
  checkpointInput,
} from "./submission-attempt-fakes";
import { describe, expect, it } from "bun:test";

const matched = {
  status: "matched" as const,
  explanation: "Matches the saved preference.",
  evidence: [],
};

function discoveryFixture() {
  const f = attemptFixture();
  const config: CampaignConfig = {
    resumeId: checkpointInput().resumeId,
    minScore: 20,
    maxApplications: 1,
    discovery: {
      phase: "complete",
      intent: "apply",
      searches: [],
      sources: [],
      completedAt: new Date().toISOString(),
      reason: "Available candidates collected and assessed.",
    },
  };
  f.state.jobs[0].campaign = {
    userId: ATTEMPT_USER,
    source: "auto_apply",
    status: "in_progress",
    config,
  };
  const fit: FitAssessment = {
    ...FIT_ASSESSMENT,
    score: 20,
    basis: { ...FIT_ASSESSMENT.basis, resumeId: config.resumeId! },
    preferenceChecks: {
      level: matched,
      location: matched,
      workMode: matched,
      employmentType: matched,
      eligibility: [],
    },
  };
  f.state.currentFit = fit;
  return { ...f, config, fit };
}

describe("candidate-list final submission check", () => {
  it("blocks a preview or collecting list even when the job was already claimed", async () => {
    for (const change of [{ phase: "collecting" as const }, { intent: "preview" as const }]) {
      const f = discoveryFixture();
      const prepared = await f.prepare();
      Object.assign(f.config.discovery!, change);
      const before = f.state.jobs[0].updatedAt;
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.attempts[0].startedAt).toBeNull();
      expect(f.state.jobs[0].updatedAt).toEqual(before);
    }
  });

  it("blocks an assessment invalidated after review by the source, JD or profile", async () => {
    const f = discoveryFixture();
    const prepared = await f.prepare();
    f.state.currentFit = null;
    await expect(
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
    ).rejects.toThrow("current original-resume/full-JD assessment");
    expect(f.state.attempts[0].startedAt).toBeNull();
  });

  it("rechecks the saved threshold, preferences and explicit eligibility before allowing Submit", async () => {
    const { fit } = discoveryFixture();
    const cases: FitAssessment[] = [
      { ...fit, score: 19 },
      { ...fit, preferenceChecks: undefined },
      {
        ...fit,
        preferenceChecks: {
          ...fit.preferenceChecks!,
          location: { ...matched, status: "mismatch" },
        },
      },
      {
        ...fit,
        preferenceChecks: {
          ...fit.preferenceChecks!,
          eligibility: [
            {
              requirement: "Canadian work authorization",
              status: "unknown",
              explanation: "Not confirmed.",
              evidence: [],
            },
          ],
        },
      },
    ];
    for (const fit of cases) {
      const f = discoveryFixture();
      const prepared = await f.prepare();
      f.state.currentFit = fit;
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.attempts[0].startedAt).toBeNull();
    }
  });

  it("refuses a reviewed PDF based on a different original resume", async () => {
    const f = discoveryFixture();
    const prepared = await f.prepare();
    f.config.resumeId = crypto.randomUUID();
    f.state.currentFit = { ...f.fit, basis: { ...f.fit.basis, resumeId: f.config.resumeId } };
    await expect(
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
    ).rejects.toThrow("original resume selected for this candidate list");
    expect(f.state.attempts[0].startedAt).toBeNull();
  });

  it("permits one current, source-matched submission and preserves recovery after preferences change", async () => {
    const f = discoveryFixture();
    const prepared = await f.prepare();
    const result = await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!);
    expect(result.began).toBe(true);
    expect(f.state.fitReads).toEqual([
      [ATTEMPT_USER, { campaignId: ATTEMPT_CAMPAIGN, jobKey: "job" }, true],
    ]);
    expect(f.state.attempts[0].startedAt).not.toBeNull();
    f.state.currentFit = null;
    f.config.discovery!.intent = "preview";
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(false);
  });

  it("blocks Submit when another campaign job has reserved the saved application cap", async () => {
    for (const status of ["applying", "applied", "pending"]) {
      const f = discoveryFixture();
      const prepared = await f.prepare();
      const otherJobId = crypto.randomUUID();
      const otherUrl = "https://employer.test/jobs/456";
      f.state.jobs.push({
        ...f.state.jobs[0],
        id: otherJobId,
        key: "other",
        url: otherUrl,
        status,
      });
      if (status === "pending")
        f.state.attempts.push({
          ...f.state.attempts[0],
          id: crypto.randomUUID(),
          jobId: otherJobId,
          canonicalUrl: otherUrl,
          originalUrl: otherUrl,
          startedAt: new Date(),
        });
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      ).rejects.toThrow("campaign application limit is reserved");
      expect(f.state.attempts[0].startedAt).toBeNull();
    }
  });

  it("does not reserve the campaign cap for unstarted jobs or jobs in another campaign", async () => {
    const f = discoveryFixture();
    const prepared = await f.prepare();
    f.state.jobs.push(
      {
        ...f.state.jobs[0],
        id: crypto.randomUUID(),
        key: "pending",
        url: "https://employer.test/jobs/456",
        status: "pending",
      },
      {
        ...f.state.jobs[0],
        id: crypto.randomUUID(),
        campaignId: crypto.randomUUID(),
        key: "another-campaign",
        url: "https://employer.test/jobs/789",
        status: "applying",
      },
    );
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(true);
  });

  it("does not add discovery scoring requirements to ordinary application campaigns", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(true);
    expect(f.state.fitReads).toHaveLength(0);
  });
});
