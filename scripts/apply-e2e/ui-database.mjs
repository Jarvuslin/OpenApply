import { assertDisposableDatabase, evidenceHash } from "./evidence-input.mjs";

const postgres = [
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
];

export async function databaseFingerprint(inGuest, database) {
  assertDisposableDatabase(database);
  const sql = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT json_build_object('kind','identity','database',current_database(),'directory',current_setting('data_directory'));
SELECT json_build_object('kind','users','rows',coalesce(json_agg(json_build_object('id',id,'email',email,'firstName',first_name,'lastName',last_name) ORDER BY id),'[]'::json)) FROM users;
SELECT json_build_object('kind','applications','rows',coalesce(json_agg(json_build_object('id',id,'userId',user_id,'company',company,'status',status,'receiptId',submission->'confirmation'->>'reference') ORDER BY id),'[]'::json)) FROM applications;
SELECT format('SELECT json_build_object(''kind'',''table'',''table'',%L,''count'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text,E''\\n'' ORDER BY row_to_json(t)::text),''''),''UTF8'')),''hex'')) FROM public.%I t;',tablename,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\\gexec
COMMIT;`;
  const output = await inGuest([...postgres, "-q", "-d", database], {
    input: sql,
    timeout: 60_000,
  });
  const rows = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const identity = rows.find((row) => row.kind === "identity");
  if (identity?.database !== database || identity.directory !== "/var/lib/postgresql/mvp")
    throw new Error("Evidence database connection reached an unexpected cluster.");
  const tables = rows
    .filter((row) => row.kind === "table")
    .map(({ table, count, sha256 }) => ({ table, count, sha256 }));
  if (
    !tables.some((table) => table.table === "submission_attempts") ||
    !tables.some((table) => table.table === "applications")
  )
    throw new Error("Preserved database does not contain application evidence.");
  return {
    database,
    clusterVerified: true,
    users: rows.find((row) => row.kind === "users")?.rows,
    applications: rows.find((row) => row.kind === "applications")?.rows,
    tables,
    sha256: evidenceHash(JSON.stringify(tables)),
  };
}

export function assertDatabaseEvidence(snapshot, input) {
  const { account } = input;
  if (
    snapshot.users?.length !== 1 ||
    snapshot.users[0].id !== account.userId ||
    snapshot.users[0].email !== account.loginEmail ||
    snapshot.users[0].firstName !== "Morgan" ||
    snapshot.users[0].lastName !== "Fixture"
  )
    throw new Error("Database is not the exact single synthetic fixture account.");
  const expected = account.applications.map((application) => ({
    ...application,
    userId: account.userId,
    status: "applied",
  }));
  if (
    snapshot.applications?.length !== expected.length ||
    expected.some((application) => {
      const actual = snapshot.applications.find((row) => row.id === application.id);
      return !actual || Object.entries(application).some(([key, value]) => actual[key] !== value);
    })
  )
    throw new Error("Database applications do not match preserved passing evidence.");
}

export function assertDatabaseUnchanged(before, after, { allowLogin = false } = {}) {
  const select = (snapshot) =>
    snapshot.tables.filter((table) => !allowLogin || table.table !== "refresh_tokens");
  if (JSON.stringify(select(before)) !== JSON.stringify(select(after)))
    throw new Error("Protected database records changed during UI verification.");
}

export async function cloneEvidenceDatabase(inGuest, input, target, onSnapshot = async () => {}) {
  assertDisposableDatabase(target);
  const source = input.environment.database;
  assertDisposableDatabase(source);
  if (source === target) throw new Error("UI clone must differ from its source database.");
  const before = await databaseFingerprint(inGuest, source);
  assertDatabaseEvidence(before, input);
  await onSnapshot({ source: before, clone: null, target, created: false });
  await inGuest([
    "createdb",
    "-h",
    "127.0.0.1",
    "-p",
    "5433",
    "-U",
    "postgres",
    "--template",
    source,
    target,
  ]);
  await onSnapshot({ source: before, clone: null, target, created: true });
  const cloned = await databaseFingerprint(inGuest, target);
  assertDatabaseEvidence(cloned, input);
  assertDatabaseUnchanged(before, cloned);
  const snapshot = { source: before, clone: cloned, target, created: true };
  await onSnapshot(snapshot);
  return snapshot;
}

export async function setClonePassword(inGuest, input, cloned, passwordHash) {
  const database = cloned.clone.database;
  assertDisposableDatabase(database);
  if (
    cloned.created !== true ||
    database === input.environment.database ||
    !/^\$argon2id\$[a-zA-Z0-9$=,+/]+$/.test(passwordHash)
  )
    throw new Error("Password reset is restricted to the freshly verified synthetic clone.");
  const current = await databaseFingerprint(inGuest, database);
  assertDatabaseEvidence(current, input);
  assertDatabaseUnchanged(cloned.clone, current);
  const sql = `BEGIN;
UPDATE users SET password_hash='${passwordHash}' WHERE id='${input.account.userId}' AND email='${input.account.loginEmail}';
COMMIT;`;
  await inGuest([...postgres, "-q", "-d", database], { input: sql });
  const after = await databaseFingerprint(inGuest, database);
  const nonUsers = (snapshot) => ({
    ...snapshot,
    tables: snapshot.tables.filter((table) => table.table !== "users"),
  });
  assertDatabaseUnchanged(nonUsers(current), nonUsers(after));
  assertDatabaseEvidence(after, input);
  return after;
}
