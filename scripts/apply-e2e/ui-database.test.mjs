import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalEvidence } from "./evidence-input.mjs";
import {
  assertDatabaseEvidence,
  assertDatabaseUnchanged,
  cloneEvidenceDatabase,
  databaseFingerprint,
  setClonePassword,
} from "./ui-database.mjs";
import { preservedEvidence } from "./ui-test-helpers.mjs";

function databaseInput() {
  const input = preservedEvidence();
  input.account = assertLocalEvidence(input.report, input.environment, input.verification);
  const snapshot = {
    database: input.environment.database,
    users: [
      {
        id: input.account.userId,
        email: input.account.loginEmail,
        firstName: "Morgan",
        lastName: "Fixture",
      },
    ],
    applications: input.account.applications.map((application) => ({
      ...application,
      userId: input.account.userId,
      status: "applied",
    })),
    tables: [
      { table: "applications", count: 4, sha256: "a".repeat(64) },
      { table: "submission_attempts", count: 4, sha256: "b".repeat(64) },
      { table: "refresh_tokens", count: 1, sha256: "c".repeat(64) },
    ],
  };
  return { input, snapshot };
}

test("database must contain exactly the preserved synthetic account and its receipt identities", () => {
  const { input, snapshot } = databaseInput();
  assertDatabaseEvidence(snapshot, input);
  for (const mutate of [
    (value) => {
      value.users[0].email = "real@example.com";
    },
    (value) => {
      value.users.push({ ...value.users[0] });
    },
    (value) => {
      value.applications[0].receiptId = "unrelated-receipt";
    },
    (value) => {
      value.applications[0].status = "failed";
    },
    (value) => {
      value.applications.pop();
    },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => assertDatabaseEvidence(changed, input));
  }
});

test("normal login may alter refresh tokens, never application evidence or profile", () => {
  const { snapshot } = databaseInput();
  const changed = structuredClone(snapshot);
  changed.tables[2].sha256 = "d".repeat(64);
  assert.throws(() => assertDatabaseUnchanged(snapshot, changed));
  assertDatabaseUnchanged(snapshot, changed, { allowLogin: true });
  changed.tables[0].sha256 = "e".repeat(64);
  assert.throws(() => assertDatabaseUnchanged(snapshot, changed, { allowLogin: true }));
});

test("database fingerprint queries only the guarded guest cluster, returns hashes without row secrets", async () => {
  const { snapshot } = databaseInput();
  const calls = [];
  const inGuest = async (args, options) => {
    calls.push({ args, options });
    return [
      { kind: "identity", database: snapshot.database, directory: "/var/lib/postgresql/mvp" },
      { kind: "users", rows: snapshot.users },
      { kind: "applications", rows: snapshot.applications },
      ...snapshot.tables.map((table) => ({ kind: "table", ...table })),
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");
  };
  const result = await databaseFingerprint(inGuest, snapshot.database);
  assert.equal(calls[0].args[0], "psql");
  assert.match(calls[0].options.input, /REPEATABLE READ READ ONLY/);
  assert.match(calls[0].options.input, /\\gexec/);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(databaseFingerprint(inGuest, "openapply"));
  assert.equal(calls.length, 1);
});

test("clone and password mutation reject unsafe or original targets before executing a command", async () => {
  const { input, snapshot } = databaseInput();
  const noCommand = async () => {
    throw new Error("must not execute");
  };
  await assert.rejects(
    cloneEvidenceDatabase(noCommand, input, input.environment.database),
    /must differ/,
  );
  await assert.rejects(cloneEvidenceDatabase(noCommand, input, "openapply"), /disposable/);
  await assert.rejects(
    setClonePassword(
      noCommand,
      input,
      { clone: snapshot, created: true },
      "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
    ),
    /freshly verified/,
  );
  await assert.rejects(
    setClonePassword(
      noCommand,
      input,
      { clone: { ...snapshot, database: "apply_e2e_ffffffffffff" }, created: false },
      "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
    ),
    /freshly verified/,
  );
});

test("source fingerprints are persisted before clone creation, and clone creation is journaled before further verification", async () => {
  const { input, snapshot } = databaseInput();
  const events = [];
  const inGuest = async (args) => {
    if (args[0] === "createdb") {
      events.push("create");
      return "";
    }
    const database = args[args.indexOf("-d") + 1];
    return [
      { kind: "identity", database, directory: "/var/lib/postgresql/mvp" },
      { kind: "users", rows: snapshot.users },
      { kind: "applications", rows: snapshot.applications },
      ...snapshot.tables.map((table) => ({ kind: "table", ...table })),
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");
  };
  await cloneEvidenceDatabase(inGuest, input, "apply_e2e_ffffffffffff", async (state) => {
    events.push(`snapshot:${state.created}:${Boolean(state.clone)}`);
  });
  assert.deepEqual(events, [
    "snapshot:false:false",
    "create",
    "snapshot:true:false",
    "snapshot:true:true",
  ]);
  events.length = 0;
  await assert.rejects(
    cloneEvidenceDatabase(inGuest, input, "apply_e2e_ffffffffffff", async () => {
      throw new Error("journal failed");
    }),
    /journal failed/,
  );
  assert.deepEqual(events, []);
});
