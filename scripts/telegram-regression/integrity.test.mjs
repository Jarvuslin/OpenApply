import assert from "node:assert/strict";
import test from "node:test";
import { assertTelegramCloneUnchanged, otherControlsFingerprint } from "./integrity.mjs";

const snapshot = (changed) => ({
  tables: [
    "submission_attempts",
    "applications",
    "jobs",
    "job_intakes",
    "resumes",
    "telegram_updates",
    "telegram_settings",
    "pilot_questions",
    "work_items",
    "refresh_tokens",
  ].map((table) => ({ table, count: 1, sha256: changed === table ? "changed" : "same" })),
});
test("UI replay may change only the exact settings, pairing and approval fixture", () => {
  for (const allowed of ["telegram_settings", "pilot_questions", "work_items", "refresh_tokens"])
    assert.doesNotThrow(() =>
      assertTelegramCloneUnchanged(snapshot(), snapshot(allowed), ["same"], ["same"]),
    );
  for (const denied of [
    "submission_attempts",
    "applications",
    "jobs",
    "job_intakes",
    "resumes",
    "telegram_updates",
  ])
    assert.throws(() => assertTelegramCloneUnchanged(snapshot(), snapshot(denied), [], []));
  assert.throws(() => assertTelegramCloneUnchanged(snapshot(), snapshot(), ["same"], ["changed"]));
});
test("subset fingerprints validate identifiers before building SQL", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
    return "";
  };
  await assert.rejects(otherControlsFingerprint(run, "production", {}));
  await assert.rejects(otherControlsFingerprint(run, "apply_e2e_000000000000", { userId: "';--" }));
  assert.equal(calls, 0);
});
