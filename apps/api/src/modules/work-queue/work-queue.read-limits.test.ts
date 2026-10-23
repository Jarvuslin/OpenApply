import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import type { RateLimitContext } from "@/common/rate-limit/limiter";
import { createQueueReadLimits } from "./work-queue.read-limits";
import { describe, expect, it, spyOn } from "bun:test";

const context = (userId = "queue-owner"): RateLimitContext => ({
  request: new Request("http://localhost/api/work-queue"),
  server: null,
  headers: {},
  user: { id: userId },
});

describe("independent queue read allowances", () => {
  it("isolates each read route's unchanged burst and each authenticated owner", () => {
    const reads = createQueueReadLimits(),
      user = context();
    for (let n = 0; n < RATE_LIMITS.workQueueRead.burst; n++) reads.list(user);
    expect(() => reads.list(user)).toThrow();
    for (const key of ["summary", "detail", "limits", "estimate", "ordered"] as const) {
      for (let n = 0; n < RATE_LIMITS.workQueueRead.burst; n++) reads[key](user);
      expect(() => reads[key](user)).toThrow();
    }
    expect(() => reads.list(context("other-owner"))).not.toThrow();
    expect(() => reads.observer(user)).not.toThrow();
  });

  it("sustains one hour of configured polling plus bounded SSE/refocus overhead and three worker views", () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const reads = createQueueReadLimits(),
        user = context();
      const counts = {
        list: 0,
        summary: 0,
        detail: 0,
        limits: 0,
        estimate: 0,
        ordered: 0,
        observer: 0,
      };
      const take = (key: keyof typeof counts) => {
        reads[key](user);
        counts[key]++;
      };
      for (let second = 0; second < 3600; second++) {
        now = second * 1000;
        if (second % 15 === 0) {
          take("list");
          take("summary");
        }
        if (second % 5 === 0) take("detail");
        if (second % 10 === 0) {
          take("ordered");
          // A changed queue invalidates its visible rows while configured polling continues.
          take("list");
          take("summary");
          take("detail");
        }
        if (second % 60 === 0) {
          take("list");
          take("summary");
          take("detail");
          take("limits");
          take("estimate");
        }
        if (second % 2 === 0) for (let slot = 0; slot < 3; slot++) take("observer");
      }
      expect(counts).toEqual({
        list: 660,
        summary: 660,
        detail: 1140,
        limits: 60,
        estimate: 60,
        ordered: 360,
        observer: 5400,
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps observer abuse bounded with exact Retry-After and independent from UI reads", () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const reads = createQueueReadLimits(),
        user = context();
      for (let n = 0; n < RATE_LIMITS.workQueueObserver.burst; n++) reads.observer(user);
      let blocked: unknown;
      try {
        reads.observer(user);
      } catch (error) {
        blocked = error;
      }
      expect(blocked).toMatchObject({ status: 429, headers: { "retry-after": "1" } });
      expect(() => reads.list(user)).not.toThrow();
      now = 1000;
      expect(() => reads.observer(user)).not.toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  it("does not spend or loosen mutation and execution-bookkeeping budgets", () => {
    const reads = createQueueReadLimits(),
      user = context();
    const mutation = rateLimit(RATE_LIMITS.workQueueMutation),
      runtime = rateLimit(RATE_LIMITS.workQueueRuntime);
    for (let n = 0; n < RATE_LIMITS.workQueueRead.burst; n++) reads.list(user);
    for (let n = 0; n < RATE_LIMITS.workQueueMutation.burst; n++) mutation(user);
    expect(() => mutation(user)).toThrow();
    for (let n = 0; n < RATE_LIMITS.workQueueRuntime.burst; n++) runtime(user);
    expect(() => runtime(user)).toThrow();
    expect(RATE_LIMITS.workQueueMutation).toMatchObject({
      limit: 240,
      windowMs: 3_600_000,
      burst: 20,
    });
    expect(RATE_LIMITS.workQueueRuntime).toMatchObject({
      limit: 3600,
      windowMs: 3_600_000,
      burst: 100,
    });
  });
});
