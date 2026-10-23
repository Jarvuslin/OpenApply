import { FIT_RUBRIC_VERSION, fitAssessmentSchema } from "@openapply/contracts/scoring";
import { assessFit } from "./assessment";
import { scoringInput } from "./fakes";
import { scoringServiceFixture } from "./service-fakes";
import { describe, expect, it } from "bun:test";

describe("ScoringService original source and persistence", () => {
  it("requires separate checks for new profile discovery scores before caching them", async () => {
    const { service, state, request } = scoringServiceFixture();
    state.job.campaign.config = {
      discovery: {
        phase: "collecting",
        intent: "preview",
        searches: [],
        sources: [],
        completedAt: null,
        reason: null,
      },
    };
    const context = await service.context("u1", request);
    await expect(service.scoreJobFit("u1", scoringInput(context))).rejects.toThrow(
      "separate preference",
    );
    expect(state.writes).toBe(0);
  });
  it("keeps an unchanged historical rubric current for reads and promotion without rewriting it", async () => {
    const { service, state, request, db } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const oldContext = { ...context, basis: { ...context.basis, version: 1 as const } };
    const historical = assessFit(oldContext, scoringInput(oldContext));
    state.job.fitAssessment = historical;
    state.job.matchScore = historical.score;
    state.job.matchReason = historical.matchReason;
    state.user.autoApply.minMatchScore = 20;

    const refreshed = await service.context("u1", request);
    expect(refreshed.basis.version).toBe(1);
    expect(refreshed.basis.sourceSha256).toBe(historical.basis.sourceSha256);
    expect(refreshed.basis.jobSha256).toBe(historical.basis.jobSha256);
    expect(refreshed.minMatchScore).toBe(20);
    expect(refreshed.cachedAssessment).toEqual(historical);
    expect(await service.currentAssessment("u1", request, db)).toEqual(historical);
    expect(fitAssessmentSchema.parse(state.job.fitAssessment)).toEqual(historical);
    expect(state.job.matchScore).toBe(historical.score);
    expect(state.writes).toBe(0);
    expect(await service.scoreJobFit("u1", scoringInput(oldContext))).toEqual(historical);
    await expect(service.scoreJobFit("u1", scoringInput(context))).rejects.toMatchObject({
      status: 409,
    });
    expect(state.writes).toBe(0);
  });

  it("uses the current rubric for changed original source or JD without clearing prior stored scores on read", async () => {
    for (const change of ["source", "description"] as const) {
      const { service, state, request } = scoringServiceFixture();
      const context = await service.context("u1", request);
      const oldContext = { ...context, basis: { ...context.basis, version: 1 as const } };
      const historical = assessFit(oldContext, scoringInput(oldContext));
      state.job.fitAssessment = historical;
      state.job.matchScore = historical.score;
      if (change === "source") state.sourceText += "\nNew original-source evidence.";
      else state.job.description += "\nSupport an additional product.";
      const refreshed = await service.context("u1", request);
      expect(refreshed.basis.version).toBe(FIT_RUBRIC_VERSION);
      expect(refreshed.cachedAssessment).toBeNull();
      expect(state.job.fitAssessment).toEqual(historical);
      expect(state.job.matchScore).toBe(historical.score);
      expect(state.writes).toBe(0);
    }
  });

  it("marks an explicitly submitted new evaluation with the current rubric and preserves cache immutability", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const input = scoringInput(context);
    input.assessments.find((item) => item.category === "responsibility")!.rating = "partial";
    const evaluated = await service.scoreJobFit("u1", input);
    expect(evaluated.basis.version).toBe(2);
    expect(evaluated.score).toBe(80);
    expect(fitAssessmentSchema.parse(state.job.fitAssessment)).toEqual(evaluated);
    expect(await service.scoreJobFit("u1", scoringInput(context))).toEqual(evaluated);
    expect(state.writes).toBe(1);
  });

  it("does not replace an applied job's historical rubric after an upgrade", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const oldContext = { ...context, basis: { ...context.basis, version: 1 as const } };
    const historical = assessFit(oldContext, scoringInput(oldContext));
    state.job.fitAssessment = historical;
    state.job.matchScore = historical.score;
    state.job.status = "applied";
    expect(await service.scoreJobFit("u1", scoringInput(oldContext))).toEqual(historical);
    state.sourceText += "\nNew original-source evidence.";
    const refreshed = await service.context("u1", request);
    expect(refreshed.basis.version).toBe(FIT_RUBRIC_VERSION);
    await expect(service.scoreJobFit("u1", scoringInput(refreshed))).rejects.toThrow(
      "historical fit assessment",
    );
    expect(state.job.fitAssessment).toEqual(historical);
    expect(state.writes).toBe(0);
  });

  it("reads the owned uploaded original, never edited content or a tailored variant", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    expect(context.resume.text).toBe(state.sourceText);
    expect(context.resume.text).not.toContain("Fabricated skill");
    expect(state.resumeSelections).toEqual([{ id: true, sourceFilename: true }]);
    expect(context.preferences).toMatchObject({
      preferredLocations: ["Toronto"],
      jobPreferences: {
        roles: ["Software engineering"],
        levels: ["Entry"],
        workModes: ["Hybrid"],
        employmentTypes: ["Full-time"],
      },
    });
  });

  it("404s a foreign job or explicit wrong/variant resume instead of substituting the primary", async () => {
    const { service, state, request } = scoringServiceFixture();
    await expect(service.context("another-user", request)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.context("u1", { ...request, resumeId: "77777777-7777-4777-8777-777777777777" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.sourceReads).toBe(0);
  });

  it("rejects an absent source and a thin job without consulting mutable content", async () => {
    const { service, state, request } = scoringServiceFixture();
    state.resume.sourceFilename = null;
    await expect(service.context("u1", request)).rejects.toThrow("original uploaded resume");
    state.resume.sourceFilename = "original.txt";
    state.job.description = "Short summary";
    await expect(service.context("u1", request)).rejects.toThrow("too thin");
    expect(state.sourceReads).toBe(0);
  });

  it("persists score, explanation and evidence in one write and reuses the same basis immutably", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const input = scoringInput(context);
    input.assessments.find((item) => item.category === "responsibility")!.rating = "partial";
    const first = await service.scoreJobFit("u1", input);
    expect(first.score).toBe(80);
    expect(state.job.matchScore).toBe(first.score);
    expect(state.job.matchReason).toBe(first.matchReason);
    expect(fitAssessmentSchema.parse(state.job.fitAssessment)).toEqual(first);
    state.resume.content = { skills: ["Every missing skill added by tailoring"] };
    state.user.autoApply.minMatchScore = 90;
    const refreshed = await service.context("u1", request);
    expect(refreshed.basis).toEqual(context.basis);
    expect(refreshed.minMatchScore).toBe(90);
    expect(await service.scoreJobFit("u1", scoringInput(refreshed))).toEqual(first);
    expect(state.writes).toBe(1);
  });

  it("invalidates cached assessments after source, JD, role or authorization changes", async () => {
    for (const field of ["source", "description", "roles", "authorization", "primary"]) {
      const { service, state, request } = scoringServiceFixture();
      const context = await service.context("u1", request);
      const input = scoringInput(context);
      await service.scoreJobFit("u1", input);
      if (field === "source") state.sourceText += "\nA new original source version.";
      if (field === "description")
        state.job.description += "\nAdditional responsibility: support production services.";
      if (field === "roles") state.user.jobPreferences.roles = ["Backend"];
      if (field === "authorization") state.user.workAuthorization[0].sponsorship = true;
      if (field === "primary") state.user.primaryResumeId = null;
      expect(await service.currentAssessment("u1", request)).toBeNull();
      await expect(service.scoreJobFit("u1", input)).rejects.toThrow();
    }
  });

  it("uses the campaign resume and threshold ahead of primary/default settings", async () => {
    const { service, state, request } = scoringServiceFixture();
    state.user.primaryResumeId = null;
    state.job.campaign.config = { resumeId: state.resume.id, minScore: 72 };
    const context = await service.context("u1", request);
    expect(context.basis.resumeId).toBe(state.resume.id);
    expect(context.minMatchScore).toBe(72);
  });

  it("rejects concurrent job or preference edits instead of saving stale evidence", async () => {
    for (const field of ["description", "preferences", "sourcePointer"]) {
      const { service, state, request } = scoringServiceFixture();
      const context = await service.context("u1", request);
      state.beforeWrite = () => {
        if (field === "description") {
          state.job.description += "\nA changed requirement.";
          state.job.updatedAt = new Date();
        }
        if (field === "preferences") state.user.jobPreferences.roles = ["Backend"];
        if (field === "sourcePointer") {
          state.resume.sourceFilename = "new-original.txt";
          state.sourceText += "\nNew source.";
        }
      };
      await expect(service.scoreJobFit("u1", scoringInput(context))).rejects.toMatchObject({
        status: 409,
      });
      expect(state.writes).toBe(0);
    }
  });

  it("can validate a cached assessment through a transaction-compatible database", async () => {
    const { service, db, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const result = await service.scoreJobFit("u1", scoringInput(context));
    expect(await service.currentAssessment("u1", request, db)).toEqual(result);
  });

  it("returns a concurrent winner without replacing its score even in the same timestamp", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const original = scoringInput(context);
    original.assessments.find((item) => item.category === "requirement")!.rating = "partial";
    const winner = assessFit(context, original);
    state.beforeWrite = () => {
      state.job.fitAssessment = winner;
      state.job.matchScore = winner.score;
      state.job.matchReason = winner.matchReason;
    };
    expect(await service.scoreJobFit("u1", scoringInput(context))).toEqual(winner);
    expect(state.writes).toBe(0);
    expect(state.job.matchScore).toBe(70);
  });

  it("preserves an applied job's historical assessment, allowing only identical-basis cache reads", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    const input = scoringInput(context);
    const result = await service.scoreJobFit("u1", input);
    state.job.status = "applied";
    expect(await service.scoreJobFit("u1", input)).toEqual(result);
    state.sourceText += "\nAdditional original source text.";
    const changed = await service.context("u1", request);
    await expect(service.scoreJobFit("u1", scoringInput(changed))).rejects.toThrow(
      "historical fit assessment",
    );
    expect(state.writes).toBe(1);
    expect(state.job.fitAssessment).toEqual(result);
  });

  it("rejects a score write when the job becomes applied concurrently", async () => {
    const { service, state, request } = scoringServiceFixture();
    const context = await service.context("u1", request);
    state.beforeWrite = () => {
      state.job.status = "applied";
    };
    await expect(service.scoreJobFit("u1", scoringInput(context))).rejects.toMatchObject({
      status: 409,
    });
    expect(state.writes).toBe(0);
  });
});
