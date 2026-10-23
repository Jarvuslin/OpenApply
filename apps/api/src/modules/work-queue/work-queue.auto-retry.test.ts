import {
  autoRetryWhere,
  MAX_AUTO_RETRIES,
  previousFailureNote,
  withPreviousFailure,
} from "./work-queue.auto-retry";
import { describe, expect, it } from "bun:test";

describe("automatic retry of failed runs", () => {
  it("only picks failed applications past the wait with retries left", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const where = autoRetryWhere("owner", now);
    expect(where).toMatchObject({
      userId: "owner",
      kind: "application",
      state: "failed",
      autoRetries: { lt: MAX_AUTO_RETRIES },
    });
    const cutoff = (where.finishedAt as { lte: Date }).lte;
    expect(cutoff.getTime()).toBe(now.getTime() - 15 * 60_000);
  });

  it("keeps the payload and records a trimmed failure for the next run", () => {
    const payload = withPreviousFailure({ source: "user" }, `  ${"x".repeat(600)}  `);
    expect(payload.source).toBe("user");
    expect(payload.previousFailure).toHaveLength(500);
    expect(withPreviousFailure(null, null).previousFailure).toBe(
      "The run failed without a recorded reason.",
    );
  });

  it("tells the retried run what to diagnose, and nothing on a first run", () => {
    expect(previousFailureNote({ previousFailure: "Login wall on Workday" })).toContain(
      '"Login wall on Workday"',
    );
    expect(previousFailureNote({})).toBe("");
    expect(previousFailureNote(null)).toBe("");
  });
});
