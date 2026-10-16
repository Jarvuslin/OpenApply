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
import { startQueueUi } from "../queue-regression/ui-environment.mjs";
import { questionRegressionOptions } from "./options.mjs";

const capitalized = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

function syntheticSnapshotCheck({ subject, emailDomain, firstName }) {
  const label = capitalized(subject);
  return (snapshot) => {
    assert.ok(snapshot.users?.length);
    assert.ok(
      snapshot.users.every(
        (user) =>
          user.email.endsWith(`@${emailDomain}`) &&
          user.firstName === firstName &&
          user.lastName === "Fixture",
      ),
      `${label} UI replay is restricted to the synthetic fixture users.`,
    );
    assert.equal(
      snapshot.applications?.length,
      0,
      `${label} fixtures cannot contain applications.`,
    );
  };
}

export async function runRegression({
  name,
  envPrefix,
  verifier,
  subject,
  databaseLabel = subject,
  databaseStage = `${databaseLabel} database regression`,
  uiStage,
  emailDomain = "questions.example.test",
  firstName = "Questions",
  assertSyntheticSnapshot = syntheticSnapshotCheck({ subject, emailDomain, firstName }),
  assertPreviousEvidence,
  databasePassed = (result) => result.status === "passed",
  storage = false,
  rememberClone,
  assertCloneUnchanged,
  startHost,
  uiHostPorts,
  observe,
}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const config = questionRegressionOptions(process.argv.slice(2));
  const evidenceDir = path.join(root, ".temp", name, config.runId);
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
  env[`${envPrefix}_DATABASE`] = identity.database;
  env[`${envPrefix}_REPORT`] = path.join(evidenceDir, "database-checks.json");
  env[`${envPrefix}_LOGIN_EMAIL`] = `${config.runId}@${emailDomain}`;
  env[`${envPrefix}_PASSWORD`] = password;
  const report = {
    version: 1,
    mode: `model-free-${subject}-regression`,
    runId: config.runId,
    database: identity.database,
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    status: "running",
    stages: [],
  };
  const save = () =>
    writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const dbArgs = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres"];
  let stage = "preflight";
  let bridge;
  let host;
  let ui;
  let source;
  let sourceReportBytes;
  let created = false;
  let storageSource;
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
      stage = `validate preserved synthetic ${subject} evidence`;
      sourceReportBytes = await readFile(path.join(config.uiSource, "report.json"));
      const previous = JSON.parse(sourceReportBytes);
      assertPreviousEvidence?.(previous);
      if (
        (!assertPreviousEvidence &&
          (previous.mode !== report.mode || previous.databaseResult?.status !== "passed")) ||
        !previous.sourceSnapshot ||
        (storage && !previous.storageSnapshot) ||
        !previous.databaseResult.ui ||
        previous.modelCalls !== 0
      )
        throw new Error(
          `UI replay requires passing, model-free ${databaseLabel} database evidence.`,
        );
      source = {
        database: previous.sourceSnapshot.database,
        fingerprint: previous.sourceSnapshot,
        ui: previous.databaseResult.ui,
      };
      const now = await databaseFingerprint(inGuest, source.database);
      assertSyntheticSnapshot(now);
      assertDatabaseUnchanged(source.fingerprint, now);
      report.databaseResult = previous.databaseResult;
      if (storage) {
        report.storageSnapshot = previous.storageSnapshot;
        storageSource = path.join(config.uiSource, "storage");
        assert.deepEqual(await storageFingerprint(storageSource), report.storageSnapshot);
      }
      report.sourceSnapshot = source.fingerprint;
      report.sourceReportSha256 = evidenceHash(sourceReportBytes);
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
      stage = databaseStage;
      let failure;
      try {
        await runCommand(["bun", "run", verifier], { cwd, env, timeout: 120_000 });
      } catch (error) {
        failure = error;
      }
      report.databaseResult = JSON.parse(await readFile(env[`${envPrefix}_REPORT`], "utf8"));
      if (failure || !databasePassed(report.databaseResult))
        throw new Error(
          `${capitalized(databaseLabel)} database assertions failed; see database-checks.json.`,
        );
      await bridge.stop();
      bridge = undefined;
      report.sourceSnapshot = await databaseFingerprint(inGuest, identity.database);
      if (storage) {
        storageSource = path.join(evidenceDir, "storage");
        report.storageSnapshot = await storageFingerprint(storageSource);
      }
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
      const clone = config.uiSource
        ? identity.database
        : runIdentity(`${config.runId}-ui`).database;
      if (clone === source.database)
        throw new Error("UI database must differ from preserved source.");
      await inGuest(["createdb", ...dbArgs, "--template", source.database, clone]);
      report.uiDatabase = clone;
      if (storage) {
        const cloneStorageRoot = path.join(evidenceDir, "ui-storage");
        await cloneStorage(storageSource, cloneStorageRoot, report.storageSnapshot);
        env.STORAGE_ROOT = cloneStorageRoot;
      }
      const cloned = await databaseFingerprint(inGuest, clone);
      assertDatabaseUnchanged(source.fingerprint, cloned);
      bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
      env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${ports.database}/${clone}`;
      env[`${envPrefix}_DATABASE`] = clone;
      env[`${envPrefix}_UI_USER`] = source.ui.userId;
      env[`${envPrefix}_LOGIN_EMAIL`] = source.ui.loginEmail;
      // Reset only this newly verified clone's synthetic login, never source records.
      await runCommand(["bun", "run", verifier, "ui-login"], { cwd, env, timeout: 30_000 });
      await rememberClone?.({ inGuest, clone, source });
      report.stages.push({ stage, status: "passed", migrations: 0 });
      stage = uiStage;
      host = await startHost?.({ root, evidenceDir, commandFor, source });
      ui = await startQueueUi({
        root,
        evidenceDir,
        identity,
        runId: config.runId,
        env,
        commandFor,
        inGuest,
        ...(uiHostPorts ? { additionalHostPorts: uiHostPorts } : {}),
      });
      report.ui = await observe(ui, {
        ...source.ui,
        webUrl: ui.webUrl,
        apiUrl: ui.apiUrl,
        cdpUrl: ui.cdpUrl,
        ...(host ? { companionUrl: host.companionUrl } : {}),
        loginEmail: source.ui.loginEmail,
        password,
        outputDir: evidenceDir,
      });
      if (report.ui.status !== "passed") throw new Error(`${capitalized(uiStage)} failed.`);
      if (host) report.host = await host.verify();
      await ui.assertSources();
      report.stages.push({ stage, status: "passed" });
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.stages.push({ stage, status: "failed", reason: error.message });
    process.exitCode = 1;
  } finally {
    for (const resource of [ui && { stop: ui.cleanup }, host, bridge].filter(Boolean)) {
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
        if (await assertCloneUnchanged?.({ inGuest, source })) report.cloneIntegrity = "passed";
        if (storage)
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
    report.cleanup = {
      bridgeClosed: !(await portOpen(ports.database)),
      providerProcessesStarted: 0,
    };
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
}
