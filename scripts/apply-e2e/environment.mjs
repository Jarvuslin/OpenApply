import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { stageBudgetedPlugin } from "./agent-stage.mjs";
import { assertSharedRuntimeIdle, inspectEnvironment, ports } from "./environment-preflight.mjs";
import {
  fetchJson,
  guestToHostBridge,
  hostToGuestBridge,
  managedProcess,
  runCommand,
  waitFor,
} from "./processes.mjs";
import { assertSourceStage, createRuntimeWorkspace } from "./source-stage.mjs";

export { inspectEnvironment } from "./environment-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function guestSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".mjs") &&
        !/(?:\.test|-test-helpers)\.mjs$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export function runIdentity(runId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,70}$/.test(runId))
    throw new Error("Use a simple unique fixture run ID.");
  const suffix = randomBytes(6).toString("hex");
  return { database: `apply_e2e_${suffix}`, guestDir: `/tmp/openapply-e2e-${runId}-${suffix}` };
}

export function assertMigrationTarget(databaseUrl, databaseName, created, connectionIdentity) {
  if (!created || !/^apply_e2e_[a-f0-9]{12}$/.test(databaseName))
    throw new Error("Migration requires a database freshly created by this fixture run.");
  const target = new URL(databaseUrl);
  if (
    target.protocol !== "postgresql:" ||
    target.hostname !== "127.0.0.1" ||
    target.port !== String(ports.database) ||
    target.pathname !== `/${databaseName}` ||
    target.username !== "postgres" ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error("Migration target is not this run's isolated database bridge.");
  if (
    connectionIdentity &&
    (connectionIdentity.database !== databaseName ||
      connectionIdentity.directory !== "/var/lib/postgresql/mvp")
  )
    throw new Error("Migration connection did not reach this run's verified guest database.");
}

export function isolatedApiEnvironment(base, { databaseUrl, storageRoot, apiUrl, webUrl }) {
  return {
    ...base,
    NODE_ENV: "development",
    OPENAPPLY_MODEL_BUDGET: '{"maxRequests":0}',
    OPENAPPLY_QUEUE_MODEL_APPROVAL: "",
    OPENAPPLY_PREPARATION_MODEL_APPROVAL: "",
    PORT: String(ports.api),
    DATABASE_URL: databaseUrl,
    JWT_SECRET: randomBytes(32).toString("hex"),
    SECRET_MASTER_KEY: randomBytes(32).toString("base64"),
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    MVP_LOCAL_RUNNER: "true",
    JOB_FEED_REFRESH_ENABLED: "false",
    STORAGE_ROOT: storageRoot,
    APP_URL: webUrl,
    CORS_ORIGINS: webUrl,
    AUTH_OAUTH_REDIRECT_BASE: apiUrl,
    RESEND_API_KEY: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "mailto:fixture@example.test",
    SUPER_ADMIN_EMAIL: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_BOT_USERNAME: "",
    TELEGRAM_WEBHOOK_SECRET: "",
    TELEGRAM_DELIVERY_ENABLED: "false",
    CAPTCHA_SOLVER_ENABLED: "false",
    PUBLIC_SITE_ENABLED: "false",
    LOG_LEVEL: "error",
  };
}

async function readBaseEnvironment() {
  try {
    return {
      ...parseEnv(await readFile(path.join(root, "apps/api/.env"), "utf8")),
      ...process.env,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { ...process.env };
    throw error;
  }
}

export async function provisionEnvironment({ runId, evidenceDir, provider = "claude", approval }) {
  if (!approval || approval.runId !== runId || approval.provider !== provider || !approval.sha256)
    throw new Error("Model execution requires a claimed one-use approval before provisioning.");
  const preflight = await inspectEnvironment({ provider });
  if (!preflight.ready) {
    const error = new Error(`Fixture preflight blocked: ${preflight.blockers.join(" ")}`);
    error.preflight = preflight;
    throw error;
  }
  const runtime = currentRuntime();
  const identity = runIdentity(runId);
  const workspace = await createRuntimeWorkspace(root);
  const storageRoot = path.join(path.resolve(evidenceDir), "environment/storage");
  const apiUrl = `http://127.0.0.1:${ports.api}`;
  const webUrl = `http://127.0.0.1:${ports.web}`;
  const companionUrl = `http://127.0.0.1:${ports.companion}`;
  const fixtureBaseUrl = `http://127.0.0.1:${ports.fixture}`;
  const cdpUrl = `http://127.0.0.1:${ports.browser}`;
  const guestBrowserDir = `/home/pilot/openapply/apply-e2e/${runId}-${identity.database.slice(10)}`;
  const guestBrowserOutputDir = `${guestBrowserDir}/browser`;
  const commandFor = (args) => guestCommand(runtime, args);
  const inGuest = (args, options = {}) => runCommand(commandFor(args), options);
  const owned = [];
  let databaseCreated = false;
  let companionStarted = false;
  let cleaned = false;
  let currentStage = "workspace";
  const stages = [];
  const sourceStages = [];
  const assertStagedSources = async () => {
    for (const stage of sourceStages) await assertSourceStage(stage);
  };
  const progress = async (stage) => {
    currentStage = stage;
    stages.push({ stage, startedAt: new Date().toISOString() });
    await writeFile(
      path.join(evidenceDir, "environment-progress.json"),
      JSON.stringify(stages, null, 2),
    );
    console.log(`[apply-e2e] Environment: ${stage}`);
  };
  const onLifecycle = (event) =>
    appendFileSync(path.join(evidenceDir, "owned-processes.jsonl"), `${JSON.stringify(event)}\n`, {
      mode: 0o600,
    });
  const start = (role, command, options) => {
    const process = managedProcess(command, { ...options, role, onLifecycle });
    owned.push(process);
    return process;
  };
  const cleanup = async ({ preserveDatabase = true } = {}) => {
    if (cleaned) return;
    cleaned = true;
    if (companionStarted) {
      await fetch(`${companionUrl}/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
    const failures = [];
    for (const resource of owned.reverse()) {
      try {
        await resource.stop();
      } catch {
        failures.push("A dedicated process did not confirm shutdown.");
      }
    }
    if (databaseCreated && !preserveDatabase) {
      await inGuest([
        "dropdb",
        "-h",
        "127.0.0.1",
        "-p",
        "5433",
        "-U",
        "postgres",
        identity.database,
      ]);
    }
    if (failures.length) throw new Error(failures.join(" "));
  };
  try {
    await assertSharedRuntimeIdle();
    await mkdir(workspace, { recursive: true });
    await progress("stage guest fixture source");
    await writeFile(path.join(evidenceDir, "preflight.json"), JSON.stringify(preflight, null, 2));
    await writeFile(
      path.join(evidenceDir, "environment.json"),
      JSON.stringify(
        {
          runId,
          database: identity.database,
          guestDir: identity.guestDir,
          apiUrl,
          webUrl,
          companionUrl,
          fixtureBaseUrl,
          cdpUrl,
          guestBrowserOutputDir,
          workspace,
          storageRoot,
          transport: "loopback-only guest stdio forwarding",
          databasePreservedByDefault: true,
        },
        null,
        2,
      ),
    );
    await inGuest(["mkdir", "-m", "700", identity.guestDir]);
    const sourceDirectory = path.join(root, "scripts/apply-e2e");
    for (const name of await guestSourceFiles(sourceDirectory)) {
      const contents = await readFile(path.join(sourceDirectory, name), "utf8");
      await inGuest(
        [
          "node",
          "-e",
          "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{mode:0o600,flag:'wx'})",
          `${identity.guestDir}/${name}`,
        ],
        { input: contents },
      );
    }
    await progress("create disposable guest database");
    await inGuest([
      "createdb",
      "-h",
      "127.0.0.1",
      "-p",
      "5433",
      "-U",
      "postgres",
      identity.database,
    ]);
    databaseCreated = true;
    owned.push(await hostToGuestBridge(ports.database, 5433, commandFor));
    const apiEnvironment = isolatedApiEnvironment(await readBaseEnvironment(), {
      databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
      storageRoot,
      apiUrl,
      webUrl,
    });
    await progress("verify disposable database connection");
    assertMigrationTarget(apiEnvironment.DATABASE_URL, identity.database, databaseCreated);
    const databaseConnection = JSON.parse(
      await runCommand(
        [
          "bun",
          "--eval",
          "const {Client}=await import('pg'); const c=new Client({connectionString:process.env.DATABASE_URL}); await c.connect(); try {const r=await c.query(\"SELECT current_database() AS database, current_setting('data_directory') AS directory\"); process.stdout.write(JSON.stringify(r.rows[0]));} finally {await c.end();}",
        ],
        { cwd: path.join(root, "apps/api"), env: apiEnvironment },
      ),
    );
    assertMigrationTarget(
      apiEnvironment.DATABASE_URL,
      identity.database,
      databaseCreated,
      databaseConnection,
    );
    await writeFile(
      path.join(evidenceDir, "database-verification.json"),
      JSON.stringify(
        { database: identity.database, guestClusterVerified: true, connectionVerified: true },
        null,
        2,
      ),
    );
    await progress("migrate disposable database");
    await runCommand(["bun", "run", "db:migrate:apply"], {
      cwd: path.join(root, "apps/api"),
      env: apiEnvironment,
      timeout: 180_000,
    });
    await progress("seed job board catalog");
    await runCommand(["bun", "run", "db:seed", "--only", "job-boards"], {
      cwd: path.join(root, "apps/api"),
      env: apiEnvironment,
      timeout: 60_000,
    });
    await progress("start isolated API");
    const apiProcess = start("api", ["bun", "run", "src/app.ts"], {
      cwd: path.join(root, "apps/api"),
      env: apiEnvironment,
    });
    await waitFor(() => fetchJson(`${apiUrl}/health`), 60_000, apiProcess.assertRunning);
    await progress("start dedicated headed browser");
    const guestProcessPath = `${identity.guestDir}/processes-guest.mjs`;
    await inGuest(["mkdir", "-p", `${guestBrowserDir}/profile`, guestBrowserOutputDir]);
    await inGuest(["chown", "-R", "pilot:pilot", guestBrowserDir]);
    await inGuest(["chmod", "700", guestBrowserDir]);
    const browserProcess = start(
      "guest-browser-supervisor",
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
    await progress("start guest ATS fixtures");
    const fixtureProcess = start(
      "guest-fixture-supervisor",
      commandFor([
        "node",
        guestProcessPath,
        "fixture",
        `${identity.guestDir}/fixture-server.mjs`,
        runId,
        identity.guestDir,
        String(ports.fixture),
      ]),
      { requireCleanExit: true },
    );
    owned.push(await hostToGuestBridge(ports.fixture, ports.fixture, commandFor));
    const fixtureManifest = await waitFor(
      () => fetchJson(`${fixtureBaseUrl}/__fixture__/manifest`),
      60_000,
      fixtureProcess.assertRunning,
    );
    await progress("build isolated companion");
    sourceStages.push(
      await stageBudgetedPlugin(
        {
          source: path.join(root, "plugin"),
          directory: path.join(workspace, "plugin"),
        },
        approval.budget.maxWorkerTurns,
        { denyFixtureMail: true },
      ),
    );
    await writeFile(
      path.join(evidenceDir, "plugin-source-inventory.json"),
      `${JSON.stringify(sourceStages[0], null, 2)}\n`,
      { flag: "wx" },
    );
    const binDir = path.join(workspace, "companion-bin");
    const dotnet = process.env.OPENAPPLY_E2E_DOTNET ?? "dotnet";
    await runCommand(
      [dotnet, "build", path.join(root, "apps/terminal"), "-c", "Release", "--output", binDir],
      { cwd: root, timeout: 180_000 },
    );
    const companionEnvironment = {
      ...process.env,
      Kestrel__Endpoints__Http__Url: companionUrl,
      Terminal__AllowedOrigins__0: webUrl,
      Terminal__AllowedOrigins__1: webUrl,
      OPENAPPLY_BROWSER_CDP_PORT: String(ports.browser),
      OPENAPPLY_BROWSER_OUTPUT_DIR: guestBrowserOutputDir,
      OPENAPPLY_MODEL_BUDGET: JSON.stringify(approval.budget),
      OPENAPPLY_USAGE_LEDGER: path.resolve(evidenceDir, "model-usage.jsonl"),
    };
    delete companionEnvironment.OPENAPPLY_API_TOKEN;
    const launchCompanion = async (queueApprovalPath, queueApiUrl = apiUrl) => {
      if (companionStarted) throw new Error("The dedicated companion cannot be launched twice.");
      if (!path.isAbsolute(queueApprovalPath ?? ""))
        throw new Error("The exact queue approval is required before companion startup.");
      const environment = { ...companionEnvironment };
      delete environment.OPENAPPLY_PREPARATION_MODEL_APPROVAL;
      environment.OPENAPPLY_QUEUE_MODEL_APPROVAL = queueApprovalPath;
      environment.OPENAPPLY_QUESTION_ALLOW_LOOPBACK = "1";
      await progress("start isolated companion");
      const companionProcess = start("companion", [dotnet, path.join(binDir, "openapply.dll")], {
        cwd: workspace,
        env: environment,
      });
      companionStarted = true;
      await waitFor(
        () => fetchJson(`${companionUrl}/healthz`),
        60_000,
        companionProcess.assertRunning,
      );
      // Bind host services first: WSL can otherwise reserve their host ports for guest forwarding.
      await progress("connect guest loopback API transport");
      const observedApi = new URL(queueApiUrl);
      if (
        observedApi.protocol !== "http:" ||
        observedApi.hostname !== "127.0.0.1" ||
        observedApi.username ||
        observedApi.password ||
        !observedApi.port
      )
        throw new Error("Queue observation must use a credential-free loopback API origin.");
      const forwardPorts = [...new Set([ports.api, ports.companion, Number(observedApi.port)])];
      const forwarding = guestToHostBridge(
        commandFor(["node", guestProcessPath, "forward", ...forwardPorts.map(String)]),
        forwardPorts,
        { role: "guest-loopback-forwarder", onLifecycle },
      );
      owned.push(forwarding);
      await waitFor(() => forwarding.ready(), 60_000, forwarding.assertRunning);
    };
    await progress("environment ready");
    const readGuestJson = async (filename) => {
      if (!filename.startsWith(`${identity.guestDir}/`) || filename.includes(".."))
        throw new Error("Evidence path is outside this fixture run.");
      return JSON.parse(await inGuest(["cat", filename]));
    };
    return {
      preflight,
      apiUrl,
      webUrl,
      companionUrl,
      fixtureBaseUrl,
      fixtureManifest,
      guestDir: identity.guestDir,
      workspace,
      cdpUrl,
      guestBrowserOutputDir,
      guestCommand: inGuest,
      readGuestJson,
      readFixtureSubmissions: () => readGuestJson(`${identity.guestDir}/submissions.json`),
      cleanup,
      assertStagedSources,
      async assertHealthy() {
        for (const resource of owned) resource.assertRunning?.();
        await assertStagedSources();
        await assertSharedRuntimeIdle();
      },
      async startQueueCompanion({ terminalToken, queueApprovalPath, queueApiUrl = apiUrl }) {
        await assertSharedRuntimeIdle();
        await assertStagedSources();
        await launchCompanion(queueApprovalPath, queueApiUrl);
        const status = await fetchJson(`${companionUrl}/queue/connect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiToken: terminalToken, apiUrl: queueApiUrl, webUrl }),
        });
        if (!status.connected || status.blockingReason)
          throw new Error("Dedicated companion did not accept the exact finite queue grant.");
        return status;
      },
    };
  } catch (error) {
    await cleanup().catch(() => {});
    throw new Error(`${currentStage}: ${error.message}`, { cause: error });
  }
}
