import {
  ATTEMPT_CAMPAIGN,
  ATTEMPT_LEASE,
  ATTEMPT_USER,
  ATTEMPT_WORK,
  attemptFixture,
} from "@/modules/application/submission-attempt-fakes";
import { describe, expect, it } from "bun:test";

describe("submission queue fence", () => {
  it("requires the exact owned application lease before granting a new Submit", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    for (const [item, token] of [
      [undefined, undefined],
      [ATTEMPT_WORK, undefined],
      [crypto.randomUUID(), ATTEMPT_LEASE],
      [ATTEMPT_WORK, crypto.randomUUID()],
    ] as const) {
      await expect(
        f.service.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!, item, token),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.attempts[0].startedAt).toBeNull();
    }
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(true);
  });

  for (const change of [
    { kind: "pilot_task" },
    { userId: crypto.randomUUID() },
    { jobId: crypto.randomUUID() },
    { leaseExpiresAt: new Date(0) },
    { state: "paused" },
    { state: "stopping" },
    { pauseRequestedAt: new Date() },
    { cancellationRequestedAt: new Date() },
  ]) {
    it(`rejects ${JSON.stringify(change)} without changing the checkpoint`, async () => {
      const f = attemptFixture();
      const prepared = await f.prepare();
      Object.assign(f.state.work, change);
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.attempts[0].startedAt).toBeNull();
    });
  }

  it("retains receipts after a valid begin loses its lease", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!);
    f.state.work.leaseExpiresAt = new Date(0);
    f.state.work.cancellationRequestedAt = new Date();
    const result = await f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
      checkpointId: prepared.checkpointId!,
      confirmation: {
        text: "Application received",
        url: "https://employer.test/receipt",
        observedAt: new Date().toISOString(),
      },
    });
    expect(result.attempt.state).toBe("recording_pending");
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(false);
  });
});
