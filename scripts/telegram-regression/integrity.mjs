import assert from "node:assert/strict";
import { assertDatabaseUnchanged } from "../apply-e2e/ui-database.mjs";

const mutable = [
  "telegram_links",
  "telegram_pairings",
  "telegram_settings",
  "telegram_setting_requests",
  "telegram_actions",
  "telegram_deliveries",
  "pilot_questions",
  "work_items",
];
export function assertTelegramCloneUnchanged(before, after, controlsBefore, controlsAfter) {
  const protectedTables = (snapshot) => ({
    ...snapshot,
    tables: snapshot.tables.filter(({ table }) => !mutable.includes(table)),
  });
  assertDatabaseUnchanged(protectedTables(before), protectedTables(after), { allowLogin: true });
  assert.deepEqual(controlsAfter, controlsBefore, "Records outside the exact UI fixture changed.");
}

export async function otherControlsFingerprint(inGuest, database, ui) {
  assert.match(database, /^apply_e2e_[a-f0-9]{12}$/);
  for (const key of ["userId", "linkId", "approvalQuestionId", "approvalJobId"])
    assert.match(ui[key], /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const predicates = mutable.map((table) => {
    if (table === "telegram_links") return `id <> '${ui.linkId}'`;
    if (["telegram_actions", "telegram_deliveries"].includes(table))
      return `user_id <> '${ui.userId}' OR link_id <> '${ui.linkId}'`;
    if (table === "pilot_questions") return `id <> '${ui.approvalQuestionId}'`;
    if (table === "work_items")
      return `user_id <> '${ui.userId}' OR job_id IS DISTINCT FROM '${ui.approvalJobId}'`;
    return `user_id <> '${ui.userId}'`;
  });
  const sql = mutable
    .map(
      (table, index) =>
        `SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM ${table} t WHERE ${predicates[index]};`,
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
  assert.equal(hashes.length, mutable.length);
  for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);
  return hashes;
}
