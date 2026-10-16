import { FIT_ASSESSMENT, setup } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("fit evidence transitions", () => {
  it("allows a manually approved unscored posting to reach its worker", async () => {
    const state = setup();
    state.setStatus("approved");
    expect((await state.claim()).status).toBe("applying");
  });

  it("rejects an existing assessment whose original source or preferences changed", async () => {
    const state = setup();
    state.setStatus("approved");
    state.setAssessment(FIT_ASSESSMENT);
    state.invalidateAssessment();
    await expect(state.claim()).rejects.toThrow("current original resume");
    expect(state.job.status).toBe("approved");
  });

  it("blocks both approval and claims outside saved desired roles", async () => {
    const state = setup();
    state.setAssessment({
      ...FIT_ASSESSMENT,
      roleMatch: { ...FIT_ASSESSMENT.roleMatch, relevance: "outside_preferences" },
    });
    state.setStatus("pending");
    await expect(state.service.patchJob("u1", "c1", "j1", { status: "approved" })).rejects.toThrow(
      "outside the saved desired roles",
    );
    state.setStatus("approved");
    await expect(state.claim()).rejects.toThrow("outside the saved desired roles");
  });

  it("invalidates actual posting changes, preserving identical and digest-only edits", async () => {
    const state = setup();
    state.setStatus("pending");
    state.setAssessment(FIT_ASSESSMENT);
    await state.service.patchJob("u1", "c1", "j1", { title: state.job.title });
    expect(state.job.fitAssessment).toEqual(FIT_ASSESSMENT);
    await state.service.patchJob("u1", "c1", "j1", {
      digest: JSON.stringify({ skills: ["TypeScript"] }),
    });
    expect(state.job.fitAssessment).toEqual(FIT_ASSESSMENT);
    expect(state.job.matchScore).toBe(90);
    await state.service.patchJob("u1", "c1", "j1", { description: "Changed requirements" });
    expect(state.job).toMatchObject({ fitAssessment: null, matchScore: null, matchReason: null });
  });

  it("requires refreshing and assessing a skipped posting before approving it", async () => {
    const state = setup();
    state.setStatus("skipped");
    state.setAssessment(FIT_ASSESSMENT);
    await state.service.rescanJob("u1", "c1", "j1", {
      action: "refresh",
      description: "New full posting",
    });
    expect(state.job).toMatchObject({ status: "skipped", fitAssessment: null, matchScore: null });
    await expect(
      state.service.rescanJob("u1", "c1", "j1", { decision: "approved" }),
    ).rejects.toThrow("current original resume");
    state.setAssessment(FIT_ASSESSMENT);
    expect((await state.service.rescanJob("u1", "c1", "j1", { decision: "approved" })).status).toBe(
      "approved",
    );
  });

  it("does not combine a changed posting with approval from old evidence", async () => {
    const state = setup();
    state.setStatus("pending");
    state.setAssessment(FIT_ASSESSMENT);
    await expect(
      state.service.patchJob("u1", "c1", "j1", { status: "approved", title: "Different role" }),
    ).rejects.toThrow("Update the posting and rescore");
    expect(state.job.status).toBe("pending");
  });

  it("allows a verified rescan with missing assessment categories to reach the worker", async () => {
    const state = setup();
    state.setStatus("skipped");
    state.setAssessment({ ...FIT_ASSESSMENT, verdict: "needs_review" });
    expect((await state.service.rescanJob("u1", "c1", "j1", { decision: "approved" })).status).toBe(
      "approved",
    );
  });

  it("keeps an unresolved role from approval and permits a factual question after inspection", async () => {
    const state = setup();
    state.setStatus("pending");
    state.setAssessment({
      ...FIT_ASSESSMENT,
      roleMatch: { ...FIT_ASSESSMENT.roleMatch, family: "Unclear", relevance: "unclear" },
    });
    await expect(state.service.patchJob("u1", "c1", "j1", { status: "approved" })).rejects.toThrow(
      "Inspect the full posting",
    );
    expect((await state.service.patchJob("u1", "c1", "j1", { status: "needs_user" })).status).toBe(
      "needs_user",
    );
  });
});
