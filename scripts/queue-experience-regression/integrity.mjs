import assert from "node:assert/strict";
import { assertDatabaseUnchanged } from "../apply-e2e/ui-database.mjs";

export function assertUiCloneUnchanged(before, after, controlsBefore, controlsAfter) {
  const select = (snapshot) => ({
    ...snapshot,
    tables: snapshot.tables.filter(({ table }) => !["work_items", "work_events"].includes(table)),
  });
  assertDatabaseUnchanged(select(before), select(after), { allowLogin: true });
  assert.deepEqual(
    controlsAfter,
    controlsBefore,
    "Records outside the exact controlled work item changed.",
  );
}

export async function protectedWorkFingerprint(inGuest, database, controlId) {
  assert.match(database, /^apply_e2e_[a-f0-9]{12}$/);
  assert.match(controlId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const sql = ["work_items", "work_events"]
    .map(
      (table) =>
        `SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM ${table} t WHERE ${table === "work_items" ? "id" : "work_item_id"} <> '${controlId}';`,
    )
    .join("\n");
  const output = await inGuest(
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
  const hashes = output.trim().split(/\r?\n/);
  assert.equal(hashes.length, 2);
  for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);
  return hashes;
}
