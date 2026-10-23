import assert from "node:assert/strict";
import test from "node:test";
import { assertConcurrencyCloneUnchanged, otherControlsFingerprint } from "./integrity.mjs";

const snapshot = () => ({
  tables: [
    "queue_policies",
    "work_requests",
    "refresh_tokens",
    "work_executions",
    "applications",
    "jobs",
  ].map((table) => ({ table, count: 1, sha256: "unchanged" })),
});
test("policy-only UI writes cannot alter execution, application or other-account evidence", () => {
  const before = snapshot(),
    after = snapshot();
  for (const row of after.tables.slice(0, 3)) row.sha256 = "changed";
  assert.doesNotThrow(() => assertConcurrencyCloneUnchanged(before, after, ["a", "b"], ["a", "b"]));
  assert.throws(() => assertConcurrencyCloneUnchanged(before, after, ["a", "b"], ["a", "changed"]));
  for (const table of ["work_executions", "applications", "jobs"]) {
    const changed = structuredClone(after);
    changed.tables.find((row) => row.table === table).sha256 = "changed";
    assert.throws(() => assertConcurrencyCloneUnchanged(before, changed, ["a", "b"], ["a", "b"]));
  }
});
test("scoped control reads reject unverified database and identity inputs before SQL", async () => {
  let calls = 0;
  const guest = async () => {
    calls++;
    return "";
  };
  await assert.rejects(
    otherControlsFingerprint(guest, "production", "00000000-0000-0000-0000-000000000000"),
  );
  await assert.rejects(otherControlsFingerprint(guest, "apply_e2e_000000000000", "arbitrary' SQL"));
  assert.equal(calls, 0);
});
