import assert from "node:assert/strict";
import { assertDatabaseUnchanged } from "../apply-e2e/ui-database.mjs";

export function assertConcurrencyCloneUnchanged(before, after, controlsBefore, controlsAfter) {
  const protectedTables = (snapshot) => ({
    ...snapshot,
    tables: snapshot.tables.filter(
      ({ table }) => !["queue_policies", "work_requests"].includes(table),
    ),
  });
  assertDatabaseUnchanged(protectedTables(before), protectedTables(after), { allowLogin: true });
  assert.deepEqual(controlsAfter, controlsBefore, "Another account's controls changed.");
}

export async function otherControlsFingerprint(inGuest, database, userId) {
  assert.match(database, /^apply_e2e_[a-f0-9]{12}$/);
  assert.match(userId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const sql = ["queue_policies", "work_requests"]
    .map(
      (table) =>
        `SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM ${table} t WHERE user_id <> '${userId}';`,
    )
    .join("\n");
  const result = await inGuest(
    [
      "psql",
      "-X",
      "-h",
      "127.0.0.1",
      "-p",
      "5433",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      database,
    ],
    { input: sql },
  );
  const hashes = result.trim().split(/\r?\n/);
  assert.equal(hashes.length, 2);
  for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);
  return hashes;
}
