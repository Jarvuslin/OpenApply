import { streamResumed } from "./connection-status";
import { expect, test } from "bun:test";

test("both scheduled waits and network recovery refresh saved state once reopened", () => {
  expect(streamResumed("waiting", "open")).toBe(true);
  expect(streamResumed("reconnecting", "open")).toBe(true);
  expect(streamResumed("connecting", "open")).toBe(false);
  expect(streamResumed("open", "open")).toBe(false);
  expect(streamResumed("waiting", "waiting")).toBe(false);
  expect(streamResumed("reconnecting", "waiting")).toBe(false);
});
