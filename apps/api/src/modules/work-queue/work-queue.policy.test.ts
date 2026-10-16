import { WORK_STATES, type WorkState } from "@openapply/contracts/work-queue";
import {
  applicationProgressState,
  checkWorkLease,
  controlState,
  LIVE_WORK_STATES,
  settledState,
  TERMINAL_WORK_STATES,
} from "./work-queue.policy";
import { describe, expect, it } from "bun:test";

describe("queue transition policy", () => {
  it("derives visible stages from canonical job progress without regression", () => {
    expect(applicationProgressState("preparing", "approved")).toBe("ready");
    expect(applicationProgressState("preparing", "applying")).toBe("filling");
    expect(applicationProgressState("ready", "applying")).toBe("filling");
    for (const state of WORK_STATES) {
      expect(applicationProgressState(state, "pending")).toBe(state);
      if (state !== "preparing" && state !== "ready")
        expect(applicationProgressState(state, "applying")).toBe(state);
    }
    expect(applicationProgressState("filling", "approved")).toBe("filling");
  });
  for (const state of WORK_STATES) {
    it(`controls ${state} without freeing a live worker`, () => {
      const item = { state, kind: "application" as const };
      for (const action of ["pause", "stop"] as const) {
        let expected: WorkState = action === "pause" ? "paused" : "cancelled";
        if (TERMINAL_WORK_STATES.includes(state)) expected = state;
        else if (LIVE_WORK_STATES.includes(state)) expected = "stopping";
        expect(controlState(item, action)).toBe(expected);
      }
      if (["paused", "needs_user", "failed", "cancelled"].includes(state))
        expect(controlState(item, "resume")).toBe("queued");
      else expect(() => controlState(item, "resume")).toThrow();
    });
  }

  it("rejects wrong, expired, missing and inactive leases", () => {
    const item = {
      state: "filling" as const,
      leaseToken: "secret",
      leaseExpiresAt: new Date(1000),
    };
    expect(() => checkWorkLease(item, "secret", new Date(999))).not.toThrow();
    expect(() => checkWorkLease(item, "wrong", new Date(999))).toThrow();
    expect(() => checkWorkLease(item, "secret", new Date(1000))).toThrow();
    expect(() =>
      checkWorkLease({ ...item, leaseExpiresAt: null }, "secret", new Date(999)),
    ).toThrow();
    for (const state of WORK_STATES.filter((state) => !LIVE_WORK_STATES.includes(state)))
      expect(() => checkWorkLease({ ...item, state }, "secret", new Date(999))).toThrow();
  });

  it("keeps durable evidence authoritative over stop, failure and reported success", () => {
    for (const outcome of ["completed", "failed", "cancelled", "waiting"] as const) {
      const input = {
        kind: "application" as const,
        recorded: false,
        ambiguous: true,
        pause: true,
        stop: true,
        outcome,
      };
      expect(settledState(input)).toBe("needs_user");
      expect(settledState({ ...input, recorded: true })).toBe("submitted");
    }
    expect(
      settledState({
        kind: "application",
        recorded: false,
        ambiguous: false,
        pause: false,
        stop: false,
        outcome: "completed",
      }),
    ).toBe("needs_user");
    expect(
      settledState({
        kind: "pilot_task",
        recorded: false,
        ambiguous: false,
        pause: false,
        stop: false,
        outcome: "completed",
      }),
    ).toBe("completed");
  });
});
