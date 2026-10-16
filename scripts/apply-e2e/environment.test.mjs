import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertMigrationTarget,
  guestSourceFiles,
  isolatedApiEnvironment,
  runIdentity,
} from "./environment.mjs";
import { sharedRuntimeBusy } from "./environment-preflight.mjs";

const idleHealth = { status: "ok", session: "stopped", pilot: { running: false } };
const idleQueue = { connected: false, running: false };

test("guest staging includes added runtime modules without copying tests or private run evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openapply-staging-"));
  for (const name of [
    "forms.mjs",
    "new-fields.mjs",
    "forms.test.mjs",
    "fixture-test-helpers.mjs",
    ".env",
    "report.json",
  ])
    await writeFile(path.join(directory, name), "fixture");
  await mkdir(path.join(directory, "directory.mjs"));
  assert.deepEqual(await guestSourceFiles(directory), ["forms.mjs", "new-fields.mjs"]);
});

test("active shared work and unknown status block; idle queue permits a separate browser", () => {
  assert.equal(sharedRuntimeBusy(idleHealth, idleQueue), false);
  assert.equal(sharedRuntimeBusy({ ...idleHealth, session: "running" }, idleQueue), true);
  assert.equal(sharedRuntimeBusy({ ...idleHealth, pilot: { running: true } }, idleQueue), true);
  assert.equal(sharedRuntimeBusy(idleHealth, { connected: true, running: false }), false);
  assert.equal(sharedRuntimeBusy(idleHealth, { connected: false, running: true }), true);
  assert.equal(sharedRuntimeBusy({ ...idleHealth, status: "degraded" }, idleQueue), true);
  assert.equal(sharedRuntimeBusy({}, idleQueue), true);
  assert.equal(sharedRuntimeBusy(idleHealth, {}), true);
});

test("fixture database and guest paths are unique and cannot target an existing application database", () => {
  const a = runIdentity("trial-2026_10_08");
  const b = runIdentity("trial-2026_10_08");
  assert.match(a.database, /^apply_e2e_[a-f0-9]{12}$/);
  assert.notEqual(a.database, b.database);
  assert.match(a.guestDir, /^\/tmp\/openapply-e2e-trial-2026_10_08-[a-f0-9]{12}$/);
  for (const runId of ["../existing", "", "a;dropdb", "run/other", "a".repeat(72)])
    assert.throws(() => runIdentity(runId));
});

test("migration refuses non-created databases, target drift, and a bridge reaching another cluster", () => {
  const name = "apply_e2e_012345678abc";
  const url = `postgresql://postgres@127.0.0.1:15433/${name}`;
  const connection = { database: name, directory: "/var/lib/postgresql/mvp" };
  assert.doesNotThrow(() => assertMigrationTarget(url, name, true, connection));
  assert.throws(() => assertMigrationTarget(url, name, false, connection), /freshly created/);
  for (const target of [
    "postgresql://postgres@127.0.0.1:5433/openapply",
    `postgresql://postgres@remote.example:15433/${name}`,
    "postgresql://postgres@127.0.0.1:15433/apply_e2e_ffffffffffff",
    `${url}?host=remote.example`,
  ])
    assert.throws(
      () => assertMigrationTarget(target, name, true, connection),
      /isolated database bridge/,
    );
  assert.throws(
    () => assertMigrationTarget(url, name, true, { ...connection, database: "openapply" }),
    /verified guest database/,
  );
  assert.throws(
    () =>
      assertMigrationTarget(url, name, true, {
        ...connection,
        directory: "/var/lib/postgresql/remote",
      }),
    /verified guest database/,
  );
});

test("isolated environment overrides production routes, storage, external delivery and authentication", () => {
  const base = {
    DATABASE_URL: "postgresql://private-remote-production/db",
    NODE_ENV: "production",
    JWT_SECRET: "existing-key",
    SECRET_MASTER_KEY: "existing-master",
    RESEND_API_KEY: "delivery-secret",
    STORAGE_ROOT: "existing-storage",
    AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
    GOOGLE_CLIENT_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "inherited-bot-secret",
    OPENAPPLY_MODEL_BUDGET: '{"maxRequests":100}',
    OPENAPPLY_QUEUE_MODEL_APPROVAL: "inherited-application-grant",
    OPENAPPLY_PREPARATION_MODEL_APPROVAL: "inherited-preparation-grant",
    TELEGRAM_BOT_USERNAME: "inherited_bot",
    TELEGRAM_WEBHOOK_SECRET: "inherited-webhook-secret",
    TELEGRAM_DELIVERY_ENABLED: "true",
    OPENAPPLY_TECTONIC_PATH: "configured-compiler",
  };
  const isolated = isolatedApiEnvironment(base, {
    databaseUrl: "postgresql://postgres@127.0.0.1:15433/apply_e2e_012345678abc",
    storageRoot: "run-only-storage",
    apiUrl: "http://127.0.0.1:14101",
    webUrl: "http://127.0.0.1:14100",
  });
  assert.equal(isolated.NODE_ENV, "development");
  assert.equal(isolated.AUTH_REQUIRE_EMAIL_VERIFICATION, "false");
  assert.equal(isolated.MVP_LOCAL_RUNNER, "true");
  assert.equal(isolated.JOB_FEED_REFRESH_ENABLED, "false");
  assert.equal(isolated.STORAGE_ROOT, "run-only-storage");
  assert.match(isolated.DATABASE_URL, /127\.0\.0\.1:15433\/apply_e2e_/);
  assert.equal(isolated.RESEND_API_KEY, "");
  assert.equal(isolated.GOOGLE_CLIENT_SECRET, "");
  assert.equal(isolated.TELEGRAM_BOT_TOKEN, "");
  assert.equal(isolated.TELEGRAM_BOT_USERNAME, "");
  assert.equal(isolated.TELEGRAM_WEBHOOK_SECRET, "");
  assert.equal(isolated.TELEGRAM_DELIVERY_ENABLED, "false");
  assert.equal(isolated.OPENAPPLY_MODEL_BUDGET, '{"maxRequests":0}');
  assert.equal(isolated.OPENAPPLY_QUEUE_MODEL_APPROVAL, "");
  assert.equal(isolated.OPENAPPLY_PREPARATION_MODEL_APPROVAL, "");
  assert.notEqual(isolated.JWT_SECRET, base.JWT_SECRET);
  assert.equal(Buffer.from(isolated.SECRET_MASTER_KEY, "base64").length, 32);
  assert.equal(isolated.OPENAPPLY_TECTONIC_PATH, "configured-compiler");
  assert.equal(base.NODE_ENV, "production");
});
