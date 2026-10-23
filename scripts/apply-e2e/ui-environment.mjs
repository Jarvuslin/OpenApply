import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { cp, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { assertMigrationTarget, isolatedApiEnvironment, runIdentity } from "./environment.mjs";
import { inspectEnvironment, ports } from "./environment-preflight.mjs";
import {
  assertEvidenceUnchanged,
  copyEvidenceStorage,
  evidenceHash,
  storageInventory,
} from "./evidence-input.mjs";
import {
  fetchJson,
  guestToHostBridge,
  hostToGuestBridge,
  managedProcess,
  runCommand,
  waitFor,
} from "./processes.mjs";
import {
  assertSourceStage,
  createRuntimeWorkspace,
  stageSourceTree,
  webStageExclusions,
} from "./source-stage.mjs";
import {
  assertDatabaseUnchanged,
  cloneEvidenceDatabase,
  databaseFingerprint,
  setClonePassword,
} from "./ui-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function provisionUiEnvironment({
  runId,
  evidenceDir,
  input,
  onStage = async () => {},
}) {
  const preflight = await inspectEnvironment({ mode: "ui" });
  if (!preflight.ready)
    throw new Error(`Model-free UI preflight blocked: ${preflight.blockers.join(" ")}`);
  const runtime = currentRuntime();
  const identity = runIdentity(runId);
  const workspace = await createRuntimeWorkspace(root);
  const storageRoot = path.join(evidenceDir, "storage");
  const apiUrl = `http://127.0.0.1:${ports.api}`;
  const webUrl = `http://127.0.0.1:${ports.web}`;
  const cdpUrl = `http://127.0.0.1:${ports.browser}`;
  const commandFor = (args) => guestCommand(runtime, args);
  const inGuest = (args, options = {}) => runCommand(commandFor(args), options);
  const owned = [];
  const sources = [];
  const onLifecycle = (event) =>
    appendFileSync(path.join(evidenceDir, "owned-processes.jsonl"), `${JSON.stringify(event)}\n`, {
      mode: 0o600,
    });
  const start = (role, command, options) => {
    const process = managedProcess(command, { ...options, role, onLifecycle });
    owned.push(process);
    return process;
  };
  let cleaned = false;
  let database;
  let protectedBefore;
  let stage = "preflight";
  const completed = async (name, detail = {}) => {
    stage = name;
    await onStage({ stage: name, status: "passed", ...detail });
  };
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    const results = await Promise.allSettled(owned.reverse().map((resource) => resource.stop()));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("A UI-only dedicated process did not confirm shutdown.");
    return { status: "passed", databasePreserved: true };
  };
  try {
    await completed("capability-preflight", { modelCalls: 0, providerCommands: 0 });
    await writeFile(
      path.join(evidenceDir, "preflight.json"),
      `${JSON.stringify(preflight, null, 2)}\n`,
    );
    await writeFile(
      path.join(evidenceDir, "environment.json"),
      `${JSON.stringify({ runId, mode: "ui-regression", database: identity.database, sourceDatabase: input.environment.database, guestDir: identity.guestDir, workspace, storageRoot, apiUrl, webUrl, cdpUrl, modelCalls: 0, companion: "not-started", fixtureServer: "not-started" }, null, 2)}\n`,
    );
    stage = "clone-disposable-database";
    database = await cloneEvidenceDatabase(inGuest, input, identity.database, async (snapshot) => {
      database = snapshot;
      await writeFile(
        path.join(evidenceDir, "database-before.json"),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
    });
    await completed(stage, {
      sourceDatabase: input.environment.database,
      database: identity.database,
      sourceSha256: database.source.sha256,
      cloneSha256: database.clone.sha256,
    });
    stage = "copy-preserved-storage";
    const storage = await copyEvidenceStorage(input, storageRoot);
    await completed(stage, {
      files: storage.length,
      sha256: evidenceHash(JSON.stringify(storage)),
    });
    const password = `UiFixture!9${randomBytes(24).toString("hex")}`;
    const passwordHash = await runCommand(
      [
        "bun",
        "--eval",
        "process.stdout.write(await Bun.password.hash(await Bun.stdin.text(),{algorithm:'argon2id'}))",
      ],
      { input: password },
    );
    protectedBefore = await setClonePassword(inGuest, input, database, passwordHash);
    await writeFile(
      path.join(evidenceDir, "database-protected-before.json"),
      `${JSON.stringify(protectedBefore, null, 2)}\n`,
    );
    await completed("clone-only-synthetic-login");
    owned.push(await hostToGuestBridge(ports.database, 5433, commandFor));
    const apiEnvironment = isolatedApiEnvironment(process.env, {
      databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
      storageRoot,
      apiUrl,
      webUrl,
    });
    assertMigrationTarget(apiEnvironment.DATABASE_URL, identity.database, database.created);
    const connection = JSON.parse(
      await runCommand(
        [
          "bun",
          "--eval",
          "const {Client}=await import('pg');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT current_database() AS database,current_setting('data_directory') AS directory\");process.stdout.write(JSON.stringify(r.rows[0]));}finally{await c.end();}",
        ],
        { cwd: path.join(root, "apps/api"), env: apiEnvironment },
      ),
    );
    assertMigrationTarget(
      apiEnvironment.DATABASE_URL,
      identity.database,
      database.created,
      connection,
    );
    await completed("disposable-database-bridge", { migration: "not-run", verified: true });
    stage = "source-staging";
    const webDirectory = path.join(workspace, "apps/web");
    sources.push(
      await stageSourceTree({
        name: "web",
        source: path.join(root, "apps/web"),
        directory: webDirectory,
        excluded: webStageExclusions,
      }),
    );
    sources.push(
      await stageSourceTree({
        name: "api",
        source: path.join(root, "apps/api"),
        directory: path.join(workspace, "apps/api"),
        excluded: ["node_modules", "dist", "coverage", "tsconfig.tsbuildinfo"],
        rootExcluded: [".temp", "storage"],
      }),
    );
    sources.push(
      await stageSourceTree({
        name: "packages",
        source: path.join(root, "packages"),
        directory: path.join(workspace, "packages"),
        excluded: ["node_modules", "dist", "tsconfig.tsbuildinfo"],
      }),
    );
    const junction = process.platform === "win32" ? "junction" : "dir";
    for (const relative of ["node_modules", "apps/web/node_modules", "apps/api/node_modules"])
      await symlink(path.join(root, relative), path.join(workspace, relative), junction);
    await cp(path.join(root, "package.json"), path.join(workspace, "package.json"));
    await writeFile(
      path.join(evidenceDir, "source-inventories.json"),
      `${JSON.stringify(sources, null, 2)}\n`,
    );
    await completed(stage, {
      inventories: "source-inventories.json",
      historicalAgentSource: "not-reconstructed",
    });
    stage = "api-readiness";
    const apiProcess = start("ui-api", ["bun", "run", "src/app.ts"], {
      cwd: path.join(workspace, "apps/api"),
      env: apiEnvironment,
    });
    await waitFor(() => fetchJson(`${apiUrl}/health`), 60_000, apiProcess.assertRunning);
    await completed(stage);
    stage = "web-readiness";
    const webProcess = start(
      "ui-web",
      [
        "bun",
        "run",
        "next",
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(ports.web),
      ],
      {
        cwd: webDirectory,
        env: {
          ...process.env,
          NEXT_PUBLIC_API_URL: apiUrl,
          INTERNAL_API_URL: apiUrl,
          NEXT_PUBLIC_TERMINAL_URL: `http://127.0.0.1:${ports.companion}`,
          OPENAPPLY_WEB_DIST_DIR: ".next",
          PUBLIC_SITE_ENABLED: "false",
        },
      },
    );
    await waitFor(
      async () => (await fetch(`${webUrl}/login`, { signal: AbortSignal.timeout(5000) })).ok,
      120_000,
      webProcess.assertRunning,
    );
    await completed(stage);
    stage = "browser-transport";
    await inGuest(["mkdir", "-m", "700", identity.guestDir]);
    const guestProcessPath = `${identity.guestDir}/processes-guest.mjs`;
    await inGuest(
      [
        "node",
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{mode:0o600,flag:'wx'})",
        guestProcessPath,
      ],
      { input: await readFile(path.join(root, "scripts/apply-e2e/processes-guest.mjs"), "utf8") },
    );
    const guestBrowserDir = `/home/pilot/openapply/apply-e2e/${runId}-${identity.database.slice(10)}`;
    await inGuest(["mkdir", "-p", `${guestBrowserDir}/profile`]);
    await inGuest(["chown", "-R", "pilot:pilot", guestBrowserDir]);
    await inGuest(["chmod", "700", guestBrowserDir]);
    const browserProcess = start(
      "ui-guest-browser-supervisor",
      commandFor([
        "node",
        guestProcessPath,
        "browser",
        `${guestBrowserDir}/profile`,
        String(ports.browser),
      ]),
      { requireCleanExit: true },
    );
    await waitFor(
      async () =>
        JSON.parse(
          await inGuest([
            "node",
            "-e",
            "fetch(process.argv[1]+'/json/version').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify({ready:!!v.webSocketDebuggerUrl}))).catch(()=>process.exit(1))",
            cdpUrl,
          ]),
        ).ready,
      60_000,
      browserProcess.assertRunning,
    );
    const forwarding = guestToHostBridge(
      commandFor(["node", guestProcessPath, "forward", String(ports.web), String(ports.api)]),
      [ports.web, ports.api],
      { role: "ui-guest-loopback-forwarder", onLifecycle },
    );
    owned.push(forwarding);
    await waitFor(() => forwarding.ready(), 60_000, forwarding.assertRunning);
    await completed(stage);
    return {
      preflight,
      apiUrl,
      webUrl,
      cdpUrl,
      uiReadOnly: true,
      fixtureManifest: input.report.manifest,
      guestCommand: inGuest,
      applicant: { loginEmail: input.account.loginEmail, password },
      databaseBefore: {
        source: database.source,
        cloned: database.clone,
        protected: protectedBefore,
      },
      cleanup,
      async assertHealthy() {
        for (const resource of owned) resource.assertRunning?.();
        for (const source of sources) await assertSourceStage(source);
      },
      async verifyEvidence() {
        const source = await databaseFingerprint(inGuest, input.environment.database);
        const clone = await databaseFingerprint(inGuest, identity.database);
        assertDatabaseUnchanged(database.source, source);
        assertDatabaseUnchanged(protectedBefore, clone, { allowLogin: true });
        const preserved = await assertEvidenceUnchanged(input);
        const afterStorage = await storageInventory(storageRoot);
        if (JSON.stringify(afterStorage) !== JSON.stringify(input.storage))
          throw new Error("Cloned application storage changed during UI verification.");
        for (const staged of sources) await assertSourceStage(staged);
        const integrity = {
          status: "passed",
          source,
          clone,
          preserved,
          cloneStorageSha256: evidenceHash(JSON.stringify(afterStorage)),
          allowedDatabaseChanges: [
            "exact synthetic user's clone-only password reset before observation",
            "normal login refresh_tokens",
          ],
        };
        await writeFile(
          path.join(evidenceDir, "evidence-after.json"),
          `${JSON.stringify(integrity, null, 2)}\n`,
        );
        return integrity;
      },
    };
  } catch (error) {
    await onStage({ stage, status: "failed", reason: error.message });
    const integrity = { status: "passed", problems: [] };
    try {
      integrity.cleanup = await cleanup();
    } catch (failure) {
      integrity.problems.push(failure.message);
    }
    try {
      integrity.preserved = await assertEvidenceUnchanged(input);
      if (database) {
        integrity.source = await databaseFingerprint(inGuest, input.environment.database);
        assertDatabaseUnchanged(database.source, integrity.source);
      }
    } catch (failure) {
      integrity.problems.push(failure.message);
    }
    if (database?.created) {
      try {
        integrity.clone = await databaseFingerprint(inGuest, identity.database);
        const baseline = protectedBefore ?? database.clone;
        if (baseline) assertDatabaseUnchanged(baseline, integrity.clone, { allowLogin: true });
      } catch (failure) {
        integrity.problems.push(failure.message);
      }
    }
    if (integrity.problems.length) integrity.status = "failed";
    await writeFile(
      path.join(evidenceDir, "evidence-after.json"),
      `${JSON.stringify(integrity, null, 2)}\n`,
    );
    await onStage({
      stage: "evidence-preservation",
      status: integrity.status,
      evidence: "evidence-after.json",
    });
    throw new Error(`UI-only ${stage}: ${error.message}`, { cause: error });
  }
}
