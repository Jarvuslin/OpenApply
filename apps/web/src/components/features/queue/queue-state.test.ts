import { canRetry, isWorking } from "./queue-state";
import { describe, expect, test } from "bun:test";

describe("queue row actions", () => {
  test.each(["failed", "needs_user", "cancelled"] as const)("%s ordinary work can retry", (state) =>
    expect(canRetry(state, null)).toBe(true),
  );

  test.each(["queued", "preparing", "submitted", "completed", "skipped"] as const)(
    "%s work never retries",
    (state) => expect(canRetry(state)).toBe(false),
  );

  test("single-use preparation and account setup never retry", () => {
    expect(canRetry("failed", "intake_prepare")).toBe(false);
    expect(canRetry("failed", "account_setup")).toBe(false);
  });

  test("only active browser states can be watched", () => {
    expect(isWorking("filling")).toBe(true);
    expect(isWorking("queued")).toBe(false);
    expect(isWorking("stopping")).toBe(false);
  });
});
