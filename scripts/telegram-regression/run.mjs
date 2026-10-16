import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import {
  assertMigrationTarget,
  isolatedApiEnvironment,
  runIdentity,
} from "../apply-e2e/environment.mjs";
import { ports } from "../apply-e2e/environment-preflight.mjs";
import { evidenceHash } from "../apply-e2e/evidence-input.mjs";
import { hostToGuestBridge, portOpen, runCommand } from "../apply-e2e/processes.mjs";
import { assertDatabaseUnchanged, databaseFingerprint } from "../apply-e2e/ui-database.mjs";
import { assertSeparateUiOutput } from "../apply-e2e/ui-run.mjs";
import { cloneStorage, storageFingerprint } from "../preparation-regression/storage.mjs";
import { questionRegressionOptions } from "../questions-regression/options.mjs";
import { startQueueUi } from "../queue-regression/ui-environment.mjs";
import { assertPassedDatabaseEvidence, assertSyntheticSnapshot } from "./evidence.mjs";
import { assertTelegramCloneUnchanged, otherControlsFingerprint } from "./integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = questionRegressionOptions(process.argv.slice(2));
const evidenceDir = path.join(root, ".temp/telegram-regression", config.runId);
if (config.uiSource) await assertSeparateUiOutput(config.uiSource, evidenceDir);
await mkdir(path.dirname(evidenceDir), { recursive: true });
await mkdir(evidenceDir);
const runtime = currentRuntime();
const commandFor = (args) => guestCommand(runtime, args);
const inGuest = (args, options) => runCommand(commandFor(args), options);
const identity = runIdentity(config.runId);
const cwd = path.join(root, "apps/api");
const password = `QuestionsFixture!9${randomBytes(24).toString("hex")}`;
const env = isolatedApiEnvironment(process.env, {
  databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
  storageRoot: path.join(evidenceDir, "storage"),
  apiUrl: `http://127.0.0.1:${ports.api}`,
  webUrl: `http://127.0.0.1:${ports.web}`,
});
env.OPENAPPLY_MODEL_BUDGET = '{"maxRequests":0}';
env.OPENAPPLY_QUEUE_MODEL_APPROVAL = "";
env.TELEGRAM_BOT_TOKEN = "123456:synthetic-telegram-fixture-no-remote-access";
env.TELEGRAM_BOT_USERNAME = "openapply_fixture_bot";
env.TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString("hex");
env.TELEGRAM_DELIVERY_ENABLED = "false";
env.OPENAPPLY_TELEGRAM_TEST_DATABASE = identity.database;
env.OPENAPPLY_TELEGRAM_TEST_REPORT = path.join(evidenceDir, "database-checks.json");
env.OPENAPPLY_TELEGRAM_TEST_LOGIN_EMAIL = `${config.runId}@questions.example.test`;
env.OPENAPPLY_TELEGRAM_TEST_PASSWORD = password;
const report = {
  version: 1,
  mode: "model-free-telegram-regression",
  runId: config.runId,
  database: identity.database,
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  externalTelegramRequests: 0,
  status: "running",
  stages: [],
};
const save = () =>
  writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const dbArgs = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres"];
let stage = "preflight";
let bridge;
let ui;
let source;
let sourceReportBytes;
let created = false;
let storageSource;
let protectedClone;
let protectedControls;
await save();
try {
  if (await portOpen(ports.database)) throw new Error("Disposable database bridge is occupied.");
  const cluster = await inGuest([
    "psql",
    "-X",
    ...dbArgs,
    "-d",
    "postgres",
    "-At",
    "-c",
    "SHOW data_directory",
  ]);
  if (cluster !== "/var/lib/postgresql/mvp") throw new Error("Unexpected database cluster.");
  if (config.uiSource) {
    stage = "validate preserved synthetic telegram evidence";
    sourceReportBytes = await readFile(path.join(config.uiSource, "report.json"));
    const previous = JSON.parse(sourceReportBytes);
    assertPassedDatabaseEvidence(previous);
    if (
      !previous.sourceSnapshot ||
      !previous.storageSnapshot ||
      !previous.databaseResult.ui ||
      previous.modelCalls !== 0
    )
      throw new Error("UI replay requires passing, model-free telegram database evidence.");
    source = {
      database: previous.sourceSnapshot.database,
      fingerprint: previous.sourceSnapshot,
      ui: previous.databaseResult.ui,
    };
    const now = await databaseFingerprint(inGuest, source.database);
    assertSyntheticSnapshot(now);
    assertDatabaseUnchanged(source.fingerprint, now);
    report.databaseResult = previous.databaseResult;
    report.storageSnapshot = previous.storageSnapshot;
    storageSource = path.join(config.uiSource, "storage");
    assert.deepEqual(await storageFingerprint(storageSource), report.storageSnapshot);
    report.sourceSnapshot = source.fingerprint;
    report.sourceReportSha256 = evidenceHash(sourceReportBytes);
    await save();
  } else {
    stage = "create and verify disposable database";
    await inGuest(["createdb", ...dbArgs, identity.database]);
    created = true;
    bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
    assertMigrationTarget(env.DATABASE_URL, identity.database, created);
    const connection = JSON.parse(
      await runCommand(
        [
          "bun",
          "--eval",
          "const {Client}=await import('pg');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT current_database() AS database,current_setting('data_directory') AS directory\");process.stdout.write(JSON.stringify(r.rows[0]));}finally{await c.end();}",
        ],
        { cwd, env },
      ),
    );
    assertMigrationTarget(env.DATABASE_URL, identity.database, created, connection);
    report.stages.push({ stage, status: "passed" });
    stage = "migrate newly verified database";
    await runCommand(["bun", "run", "db:migrate:apply"], { cwd, env, timeout: 180_000 });
    report.stages.push({ stage, status: "passed" });
    stage = "telegram database regression";
    let failure;
    try {
      await runCommand(["bun", "run", "scripts/verify-telegram.ts"], {
        cwd,
        env,
        timeout: 120_000,
      });
    } catch (error) {
      failure = error;
    }
    report.databaseResult = JSON.parse(await readFile(env.OPENAPPLY_TELEGRAM_TEST_REPORT, "utf8"));
    if (failure || report.databaseResult.passed !== true)
      throw new Error("Telegram database assertions failed; see database-checks.json.");
    await bridge.stop();
    bridge = undefined;
    report.sourceSnapshot = await databaseFingerprint(inGuest, identity.database);
    storageSource = path.join(evidenceDir, "storage");
    report.storageSnapshot = await storageFingerprint(storageSource);
    assertSyntheticSnapshot(report.sourceSnapshot);
    source = {
      database: identity.database,
      fingerprint: report.sourceSnapshot,
      ui: report.databaseResult.ui,
    };
    report.stages.push({ stage, status: "passed" });
    await save();
  }
  if (!config.databaseOnly) {
    stage = "clone synthetic evidence for rendered UI";
    const clone = config.uiSource ? identity.database : runIdentity(`${config.runId}-ui`).database;
    if (clone === source.database)
      throw new Error("UI database must differ from preserved source.");
    await inGuest(["createdb", ...dbArgs, "--template", source.database, clone]);
    report.uiDatabase = clone;
    const cloneStorageRoot = path.join(evidenceDir, "ui-storage");
    await cloneStorage(storageSource, cloneStorageRoot, report.storageSnapshot);
    env.STORAGE_ROOT = cloneStorageRoot;
    const cloned = await databaseFingerprint(inGuest, clone);
    assertDatabaseUnchanged(source.fingerprint, cloned);
    bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
    env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${ports.database}/${clone}`;
    env.OPENAPPLY_TELEGRAM_TEST_DATABASE = clone;
    env.OPENAPPLY_TELEGRAM_TEST_UI_USER = source.ui.userId;
    env.OPENAPPLY_TELEGRAM_TEST_LOGIN_EMAIL = source.ui.loginEmail;
    // Reset only this newly verified clone's synthetic login, never source records.
    await runCommand(["bun", "run", "scripts/verify-telegram.ts", "ui-login"], {
      cwd,
      env,
      timeout: 30_000,
    });
    protectedClone = await databaseFingerprint(inGuest, clone);
    protectedControls = await otherControlsFingerprint(inGuest, clone, source.ui);
    report.stages.push({ stage, status: "passed", migrations: 0 });
    stage = "rendered Telegram channel verification";
    report.stages.push({ stage, status: "running" });
    await save();
    ui = await startQueueUi({
      root,
      evidenceDir,
      identity,
      runId: config.runId,
      env,
      commandFor,
      inGuest,
    });
    const { observeTelegramUi } = await import("./observe-ui.mjs");
    report.ui = await observeTelegramUi(ui, {
      ...source.ui,
      webUrl: ui.webUrl,
      apiUrl: ui.apiUrl,
      cdpUrl: ui.cdpUrl,
      loginEmail: source.ui.loginEmail,
      password,
      outputDir: evidenceDir,
    });
    if (report.ui.status !== "passed")
      throw new Error("Rendered Telegram channel verification failed.");
    await ui.assertSources();
    report.stages = report.stages.filter(
      (entry) => entry.stage !== stage || entry.status !== "running",
    );
    report.stages.push({ stage, status: "passed" });
  }
  report.status = "passed";
} catch {
  report.status = "failed";
  report.stages.push({
    stage,
    status: "failed",
    reason: "Stage failed; inspect its bounded verifier evidence.",
  });
  process.exitCode = 1;
} finally {
  for (const resource of [ui && { stop: ui.cleanup }, bridge].filter(Boolean)) {
    try {
      await resource.stop();
    } catch {
      report.status = "failed";
      report.stages.push({ stage: "cleanup", status: "failed" });
      process.exitCode = 1;
    }
  }
  if (source) {
    try {
      if (protectedClone) {
        assertTelegramCloneUnchanged(
          protectedClone,
          await databaseFingerprint(inGuest, protectedClone.database),
          protectedControls,
          await otherControlsFingerprint(inGuest, protectedClone.database, source.ui),
        );
        report.cloneIntegrity = "passed";
      }
      assert.deepEqual(await storageFingerprint(storageSource), report.storageSnapshot);
      assertDatabaseUnchanged(
        source.fingerprint,
        await databaseFingerprint(inGuest, source.database),
      );
      if (sourceReportBytes)
        assert.equal(
          evidenceHash(await readFile(path.join(config.uiSource, "report.json"))),
          evidenceHash(sourceReportBytes),
          "Preserved source report changed.",
        );
      report.sourceIntegrity = "passed";
    } catch (error) {
      report.status = "failed";
      report.stages.push({
        stage: "preserved source integrity",
        status: "failed",
        reason: error.message,
      });
      process.exitCode = 1;
    }
  }
  report.databasePreserved = created || Boolean(report.uiDatabase);
  report.cleanup = { bridgeClosed: !(await portOpen(ports.database)), providerProcessesStarted: 0 };
  await save();
  console.log(
    JSON.stringify(
      {
        status: report.status,
        runId: report.runId,
        database: report.database,
        uiDatabase: report.uiDatabase,
        modelCalls: report.modelCalls,
        checks: report.databaseResult?.checks?.length,
        ui: report.ui?.status,
        sourceIntegrity: report.sourceIntegrity,
        evidenceDir,
        stages: report.stages,
      },
      null,
      2,
    ),
  );
}
