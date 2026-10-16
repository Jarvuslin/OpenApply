import { setup } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("submission-safe job transitions", () => {
  it("rejects claim and requeue after permission was issued without inventing an outcome", async () => {
    const state = setup();
    state.setAttempt({ startedAt: new Date() });
    await expect(state.service.patchJob("u1", "c1", "j1", { status: "approved" })).rejects.toThrow(
      "requires recovery",
    );
    expect(state.job.status).toBe("applying");
    expect(state.job.appliedAt).toBeNull();
    state.setStatus("approved");
    await expect(state.claim()).rejects.toThrow("requires recovery");
    expect(state.job.status).toBe("approved");
    expect(state.job.skipReason).toBeNull();
  });

  it("prevents retry or rescan from erasing a saved receipt", async () => {
    const state = setup();
    state.setAttempt({ startedAt: new Date(), receiptStoredAt: new Date() });
    state.setStatus("failed");
    await expect(state.service.retryJob("u1", "c1", "j1", {})).rejects.toThrow(
      "Employer confirmation is saved",
    );
    state.setStatus("skipped");
    await expect(
      state.service.rescanJob("u1", "c1", "j1", { decision: "approved" }),
    ).rejects.toThrow("Employer confirmation is saved");
    await expect(
      state.service.rescanJob("u1", "c1", "j1", { action: "refresh", description: "replacement" }),
    ).rejects.toThrow("Employer confirmation is saved");
  });

  it("protects legacy unknown outcomes and permits only a visible recovery status", async () => {
    const state = setup();
    state.setAttempt({ legacyOutcomeUnknown: true, canonicalUrl: null });
    await expect(
      state.service.patchJob("u1", "c1", "j1", { description: "replacement" }),
    ).rejects.toThrow("requires recovery");
    expect((await state.service.patchJob("u1", "c1", "j1", { status: "needs_user" })).status).toBe(
      "needs_user",
    );
    await expect(state.service.patchJob("u1", "c1", "j1", { status: "approved" })).rejects.toThrow(
      "requires recovery",
    );
    expect(state.job.appliedAt).toBeNull();
  });

  it("allows its own unstarted checkpoint to resume but rejects another job's reservation", async () => {
    const state = setup();
    state.setStatus("approved");
    state.setAttempt({});
    expect((await state.claim()).status).toBe("applying");
    state.setStatus("approved");
    state.setAttempt({ jobId: "another-campaign-job" });
    await expect(state.claim()).rejects.toThrow("Another job already holds");
  });
});
