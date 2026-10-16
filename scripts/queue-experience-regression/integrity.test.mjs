import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUiCloneUnchanged, protectedWorkFingerprint } from "./integrity.mjs";

const table = (name, hash = "old") => ({ table: name, count: 1, sha256: hash });
const before = {
  tables: [
    "work_items",
    "work_events",
    "refresh_tokens",
    "applications",
    "submission_attempts",
    "users",
    "api_tokens",
  ].map((t) => table(t)),
};
test("only login and the exact control item/event slice can change", () => {
  const after = {
    tables: before.tables.map((t) =>
      ["work_items", "work_events", "refresh_tokens"].includes(t.table) ? table(t.table, "new") : t,
    ),
  };
  assertUiCloneUnchanged(before, after, ["protected"], ["protected"]);
  assert.throws(() => assertUiCloneUnchanged(before, after, ["protected"], ["changed"]));
  for (const name of ["applications", "submission_attempts", "users", "api_tokens"]) {
    const changed = {
      tables: after.tables.map((t) => (t.table === name ? table(name, "new") : t)),
    };
    assert.throws(
      () => assertUiCloneUnchanged(before, changed, ["protected"], ["protected"]),
      name,
    );
  }
});
test("fingerprint filters exact control ID, not the entire account", async () => {
  let sql;
  const result = await protectedWorkFingerprint(
    async (_args, options) => {
      sql = options.input;
      return `${"a".repeat(64)}\n${"b".repeat(64)}`;
    },
    "apply_e2e_123456789abc",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.length, 2);
  assert.match(sql, /WHERE id <>/);
  assert.match(sql, /WHERE work_item_id <>/);
  assert.doesNotMatch(sql, /user_id/);
  await assert.rejects(
    protectedWorkFingerprint(() => assert.fail("must not execute"), "production", "bad"),
  );
});
