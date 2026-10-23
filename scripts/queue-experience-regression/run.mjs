import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { isolatedApiEnvironment, runIdentity } from "../apply-e2e/environment.mjs";
import { ports } from "../apply-e2e/environment-preflight.mjs";
import { evidenceHash } from "../apply-e2e/evidence-input.mjs";
import { hostToGuestBridge, portOpen, runCommand } from "../apply-e2e/processes.mjs";
import { assertDatabaseUnchanged, databaseFingerprint } from "../apply-e2e/ui-database.mjs";
import { assertSeparateUiOutput } from "../apply-e2e/ui-run.mjs";
import { cloneStorage, storageFingerprint } from "../preparation-regression/storage.mjs";
import { startQueueUi } from "../queue-regression/ui-environment.mjs";
import { assertPassedDatabaseEvidence } from "../telegram-regression/evidence.mjs";
import { assertPhase9Evidence, assertSyntheticSnapshot } from "./evidence.mjs";
import { assertUiCloneUnchanged, protectedWorkFingerprint } from "./integrity.mjs";
import { queueExperienceOptions } from "./options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = queueExperienceOptions(process.argv.slice(2));
const input = config.seedSource ?? config.uiSource;
const evidenceDir = path.join(root, ".temp/queue-experience-regression", config.runId);
await assertSeparateUiOutput(input, evidenceDir);
await mkdir(path.dirname(evidenceDir), { recursive: true });
await mkdir(evidenceDir);
const identity = runIdentity(config.runId);
const runtime = currentRuntime();
const commandFor = (args) => guestCommand(runtime, args);
const inGuest = (args, options) => runCommand(commandFor(args), options);
const password = `QueueExperience!9${randomBytes(24).toString("hex")}`;
const env = isolatedApiEnvironment(process.env, {
  databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
  storageRoot: path.join(evidenceDir, "storage"),
  apiUrl: `http://127.0.0.1:${ports.api}`,
  webUrl: `http://127.0.0.1:${ports.web}`,
});
Object.assign(env, {
  OPENAPPLY_MODEL_BUDGET: '{"maxRequests":0}',
  OPENAPPLY_QUEUE_MODEL_APPROVAL: "",
  OPENAPPLY_PREPARATION_MODEL_APPROVAL: "",
  TELEGRAM_DELIVERY_ENABLED: "false",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_BOT_USERNAME: "",
  TELEGRAM_WEBHOOK_SECRET: "",
  OPENAPPLY_QUEUE_EXPERIENCE_DATABASE: identity.database,
  OPENAPPLY_QUEUE_EXPERIENCE_PASSWORD: password,
  OPENAPPLY_QUEUE_EXPERIENCE_REPORT: path.join(evidenceDir, "fixture-result.json"),
});
const report = {
  version: 1,
  mode: "model-free-queue-experience-regression",
  runId: config.runId,
  database: identity.database,
  status: "running",
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  externalRequests: 0,
  stages: [],
};
const save = () =>
  writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
let stage = "validate preserved source",
  source,
  sourceBytes,
  sourceStorage,
  ui,
  bridge;
let cloneBefore, protectedBefore, cloneStorageBefore;
await save();
try {
  sourceBytes = await readFile(path.join(input, "report.json"));
  const previous = JSON.parse(sourceBytes);
  if (config.seedSource) {
    assertPassedDatabaseEvidence(previous);
    assert.equal(previous.status, "passed");
    assert.equal(previous.sourceIntegrity, "passed");
  } else assertPhase9Evidence(previous);
  source = previous.sourceSnapshot;
  assertSyntheticSnapshot(source);
  sourceStorage = previous.storageSnapshot;
  assert.ok(sourceStorage && source.database !== identity.database);
  assertDatabaseUnchanged(source, await databaseFingerprint(inGuest, source.database));
  assert.deepEqual(await storageFingerprint(path.join(input, "storage")), sourceStorage);
  report.parentReportSha256 = evidenceHash(sourceBytes);
  report.parentDatabase = source.database;
  if (await portOpen(ports.database)) throw new Error("Disposable bridge is occupied.");
  const cluster = await inGuest([
    "psql",
    "-X",
    "-h",
    "127.0.0.1",
    "-p",
    "5433",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-c",
    "SHOW data_directory",
  ]);
  assert.equal(cluster, "/var/lib/postgresql/mvp");
  stage = "clone verified synthetic source";
  await inGuest([
    "createdb",
    "-h",
    "127.0.0.1",
    "-p",
    "5433",
    "-U",
    "postgres",
    "--template",
    source.database,
    identity.database,
  ]);
  report.databasePreserved = true;
  assertDatabaseUnchanged(source, await databaseFingerprint(inGuest, identity.database));
  await cloneStorage(path.join(input, "storage"), env.STORAGE_ROOT, sourceStorage);
  bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
  env.OPENAPPLY_QUEUE_EXPERIENCE_SOURCE_DATABASE = source.database;
  const cwd = path.join(root, "apps/api");
  if (config.seedSource) {
    stage = "seed Phase 9 synthetic evidence once";
    Object.assign(env, {
      OPENAPPLY_QUEUE_EXPERIENCE_EMAIL: `${config.runId}@questions.example.test`,
      OPENAPPLY_QUEUE_EXPERIENCE_SOURCE_USER: previous.databaseResult.ui.userId,
      OPENAPPLY_QUEUE_EXPERIENCE_CHECKPOINT: previous.databaseResult.ui.approvalCheckpointId,
    });
    await runCommand(
      ["bun", path.join(root, "scripts/queue-experience-regression/fixture-bootstrap.mjs"), "seed"],
      {
        cwd,
        env,
        timeout: 60_000,
      },
    );
    report.seed = JSON.parse(await readFile(env.OPENAPPLY_QUEUE_EXPERIENCE_REPORT, "utf8"));
    assert.equal(report.seed.passed, true);
    await bridge.stop();
    bridge = undefined;
    report.sourceSnapshot = await databaseFingerprint(inGuest, identity.database);
    report.storageSnapshot = await storageFingerprint(env.STORAGE_ROOT);
    assertSyntheticSnapshot(report.sourceSnapshot);
    report.stages.push({ stage, status: "passed", migrations: 0, seedRuns: 1 });
  } else {
    stage = "reset verified UI clone login";
    report.seed = previous.seed;
    report.sourceSnapshot = source;
    report.storageSnapshot = sourceStorage;
    Object.assign(env, {
      OPENAPPLY_QUEUE_EXPERIENCE_EMAIL: previous.seed.ui.loginEmail,
      OPENAPPLY_QUEUE_EXPERIENCE_USER: previous.seed.ui.userId,
    });
    await runCommand(
      [
        "bun",
        path.join(root, "scripts/queue-experience-regression/fixture-bootstrap.mjs"),
        "ui-login",
      ],
      {
        cwd,
        env,
        timeout: 30_000,
      },
    );
    report.login = JSON.parse(await readFile(env.OPENAPPLY_QUEUE_EXPERIENCE_REPORT, "utf8"));
    assert.equal(report.login.seededApplications, 0);
    cloneBefore = await databaseFingerprint(inGuest, identity.database);
    protectedBefore = await protectedWorkFingerprint(
      inGuest,
      identity.database,
      report.seed.ui.controlId,
    );
    cloneStorageBefore = await storageFingerprint(env.STORAGE_ROOT);
    report.stages.push({ stage, status: "passed", migrations: 0, seedRuns: 0 });
    stage = "rendered laptop queue experience";
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
    const { observeQueueExperienceUi } = await import("./observe-ui.mjs");
    report.ui = await observeQueueExperienceUi(ui, {
      ...report.seed.ui,
      webUrl: ui.webUrl,
      apiUrl: ui.apiUrl,
      cdpUrl: ui.cdpUrl,
      companionUrl: `http://127.0.0.1:${ports.companion}`,
      password,
      outputDir: evidenceDir,
    });
    assert.equal(report.ui.status, "passed");
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
    reason: "Inspect bounded fixture or observer evidence; source acceptance was not rerun.",
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
  try {
    if (cloneBefore) {
      assertUiCloneUnchanged(
        cloneBefore,
        await databaseFingerprint(inGuest, identity.database),
        protectedBefore,
        await protectedWorkFingerprint(inGuest, identity.database, report.seed.ui.controlId),
      );
      assert.deepEqual(await storageFingerprint(env.STORAGE_ROOT), cloneStorageBefore);
      report.cloneIntegrity = "passed";
    }
    if (source) {
      assertDatabaseUnchanged(source, await databaseFingerprint(inGuest, source.database));
      assert.deepEqual(await storageFingerprint(path.join(input, "storage")), sourceStorage);
      assert.equal(
        evidenceHash(await readFile(path.join(input, "report.json"))),
        evidenceHash(sourceBytes),
      );
      report.sourceIntegrity = "passed";
    }
  } catch {
    report.status = "failed";
    report.stages.push({ stage: "evidence integrity", status: "failed" });
    process.exitCode = 1;
  }
  report.cleanup = { bridgeClosed: !(await portOpen(ports.database)), providerProcessesStarted: 0 };
  if (!report.cleanup.bridgeClosed) {
    report.status = "failed";
    report.stages.push({ stage: "bridge cleanup", status: "failed" });
    process.exitCode = 1;
  }
  await save();
  console.log(
    JSON.stringify({
      status: report.status,
      runId: report.runId,
      database: identity.database,
      ui: report.ui?.status,
      sourceIntegrity: report.sourceIntegrity,
      cloneIntegrity: report.cloneIntegrity,
      evidenceDir,
      stages: report.stages,
    }),
  );
}
