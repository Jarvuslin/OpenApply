import { intakeRequest } from "./intake-request";
import { expect, test } from "bun:test";

const current = {
  intakeId: "candidate-a",
  accountId: "account-a",
  revision: 1,
  provider: "claude" as const,
};
test("a pending intake action never follows navigation to another candidate or account", () => {
  const pending = intakeRequest(current, "queue", null);
  expect(pending).not.toBeNull();
  expect(intakeRequest({ ...current, intakeId: "candidate-b" }, "queue", pending)).toBeNull();
  expect(intakeRequest({ ...current, accountId: "account-b" }, "queue", pending)).toBeNull();
  expect(intakeRequest({ ...current, accountId: "" }, "queue", pending)).toBeNull();
  expect(intakeRequest(current, "skip", pending)).toBeNull();
});
test("lost acknowledgement preserves exact revision and provider after a background refresh", () => {
  const pending = intakeRequest(current, "prepare", null);
  expect(intakeRequest({ ...current, revision: 2, provider: "codex" }, "prepare", pending)).toBe(
    pending,
  );
});
