import assert from "node:assert/strict";
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
import {
  assertPassedDatabaseEvidence,
  assertSyntheticSnapshot,
} from "../telegram-regression/evidence.mjs";

const [flag, runId, sourceFlag, sourceDir, ...extra] = process.argv.slice(2);
assert.ok(
  flag === "--run-id" && sourceFlag === "--source" && runId && sourceDir && !extra.length,
  "Use --run-id <fresh-id> --source <passing-telegram-evidence-dir>.",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const identity = runIdentity(runId);
const directory = path.join(root, ".temp/intake-preparation-regression", runId);
const sourcePath = path.resolve(sourceDir);
await assertSeparateUiOutput(sourcePath, directory);
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory);
const commandFor = (args) => guestCommand(currentRuntime(), args);
const inGuest = (args, options) => runCommand(commandFor(args), options);
const dbArgs = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres"];
const report = {
  runId,
  database: identity.database,
  mode: "model-free-intake-preparation-database",
  status: "running",
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  migrations: 0,
  stages: [],
};
const save = () =>
  writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
let stage = "verify source and disposable cluster";
let bridge;
let source;
let sourceBytes;
let created = false;
await save();
try {
  if (await portOpen(ports.database)) throw new Error("Dedicated bridge is occupied.");
  assert.equal(
    await inGuest(["psql", "-X", ...dbArgs, "-d", "postgres", "-At", "-c", "SHOW data_directory"]),
    "/var/lib/postgresql/mvp",
  );
  sourceBytes = await readFile(path.join(sourcePath, "report.json"));
  source = JSON.parse(sourceBytes);
  assertPassedDatabaseEvidence(source);
  assertSyntheticSnapshot(source.sourceSnapshot);
  assertDatabaseUnchanged(
    source.sourceSnapshot,
    await databaseFingerprint(inGuest, source.sourceSnapshot.database),
  );
  assert.deepEqual(
    await storageFingerprint(path.join(sourcePath, "storage")),
    source.storageSnapshot,
  );
  report.sourceDatabase = source.sourceSnapshot.database;
  report.sourceReportSha256 = evidenceHash(sourceBytes);
  report.stages.push({ stage, status: "passed" });
  stage = "create and verify fresh clone";
  await inGuest([
    "createdb",
    ...dbArgs,
    "--template",
    source.sourceSnapshot.database,
    identity.database,
  ]);
  created = true;
  assertDatabaseUnchanged(
    source.sourceSnapshot,
    await databaseFingerprint(inGuest, identity.database),
  );
  const storageRoot = path.join(directory, "storage");
  await cloneStorage(path.join(sourcePath, "storage"), storageRoot, source.storageSnapshot);
  bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
  const env = isolatedApiEnvironment(process.env, {
    databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
    storageRoot,
    apiUrl: `http://127.0.0.1:${ports.api}`,
    webUrl: `http://127.0.0.1:${ports.web}`,
  });
  assertMigrationTarget(env.DATABASE_URL, identity.database, created);
  env.OPENAPPLY_PREPARATION_TEST_DATABASE = identity.database;
  env.OPENAPPLY_PREPARATION_TEST_REPORT = path.join(directory, "database-checks.json");
  report.stages.push({ stage, status: "passed" });
  stage = "narrow capability and priority database assertions";
  report.stages.push({ stage, status: "running" });
  await save();
  let failed = false;
  try {
    await runCommand(["bun", "run", "scripts/verify-intake-preparation.ts"], {
      cwd: path.join(root, "apps/api"),
      env,
      timeout: 120_000,
    });
  } catch {
    failed = true;
  }
  report.databaseResult = JSON.parse(await readFile(env.OPENAPPLY_PREPARATION_TEST_REPORT, "utf8"));
  if (failed || report.databaseResult.passed !== true)
    throw new Error("Database assertions failed; inspect bounded database-checks.json.");
  report.stages = report.stages.filter((entry) => entry.status !== "running");
  report.stages.push({ stage, status: "passed" });
  report.status = "passed";
} catch {
  report.status = "failed";
  report.stages.push({
    stage,
    status: "failed",
    reason: "Stage failed; inspect bounded verifier evidence. No automatic retry.",
  });
  process.exitCode = 1;
} finally {
  try {
    await bridge?.stop();
  } catch {
    report.status = "failed";
    report.cleanupError = true;
    process.exitCode = 1;
  }
  if (source) {
    try {
      assertDatabaseUnchanged(
        source.sourceSnapshot,
        await databaseFingerprint(inGuest, source.sourceSnapshot.database),
      );
      assert.deepEqual(
        await storageFingerprint(path.join(sourcePath, "storage")),
        source.storageSnapshot,
      );
      assert.equal(
        evidenceHash(await readFile(path.join(sourcePath, "report.json"))),
        evidenceHash(sourceBytes),
      );
      report.sourceIntegrity = "passed";
    } catch {
      report.sourceIntegrity = "failed";
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  report.databasePreserved = created;
  report.cleanup = { bridgeClosed: !(await portOpen(ports.database)), providerProcessesStarted: 0 };
  if (!report.cleanup.bridgeClosed) {
    report.status = "failed";
    process.exitCode = 1;
  }
  await save();
  console.log(
    JSON.stringify({
      runId,
      status: report.status,
      database: report.database,
      checks: report.databaseResult?.checks?.length,
      sourceIntegrity: report.sourceIntegrity,
      stages: report.stages,
      evidenceDir: directory,
    }),
  );
}
