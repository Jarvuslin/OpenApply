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
import { hostToGuestBridge, portOpen, runCommand } from "../apply-e2e/processes.mjs";
import { startQueueUi } from "./ui-environment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [flag, runId, ...extra] = process.argv.slice(2);
if (flag !== "--run-id" || !runId || extra.length)
  throw new Error("Usage: node scripts/queue-regression/run.mjs --run-id <unique-id>");
const identity = runIdentity(runId);
const evidenceDir = path.join(root, ".temp/queue-regression", runId);
await mkdir(path.dirname(evidenceDir), { recursive: true });
await mkdir(evidenceDir);
const runtime = currentRuntime();
const commandFor = (args) => guestCommand(runtime, args);
const inGuest = (args, options) => runCommand(commandFor(args), options);
let bridge;
let ui;
let created = false;
let stage = "database preflight";
const report = {
  runId,
  database: identity.database,
  mode: "model-free-queue-regression",
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  status: "running",
  stages: [],
};
const save = () =>
  writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
try {
  if (await portOpen(ports.database))
    throw new Error("Disposable database bridge port is already occupied.");
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
  if (cluster !== "/var/lib/postgresql/mvp") throw new Error("Unexpected database cluster.");
  stage = "create disposable database";
  await inGuest(["createdb", "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", identity.database]);
  created = true;
  bridge = await hostToGuestBridge(ports.database, 5433, commandFor);
  const env = isolatedApiEnvironment(process.env, {
    databaseUrl: `postgresql://postgres@127.0.0.1:${ports.database}/${identity.database}`,
    storageRoot: path.join(evidenceDir, "storage"),
    apiUrl: `http://127.0.0.1:${ports.api}`,
    webUrl: `http://127.0.0.1:${ports.web}`,
  });
  env.OPENAPPLY_QUEUE_TEST_DATABASE = identity.database;
  env.OPENAPPLY_QUEUE_TEST_REPORT = path.join(evidenceDir, "database-checks.json");
  env.OPENAPPLY_QUEUE_TEST_LOGIN_EMAIL = `${runId}@queue.example.test`;
  env.OPENAPPLY_QUEUE_TEST_PASSWORD = `QueueFixture!9${randomBytes(24).toString("hex")}`;
  env.OPENAPPLY_MODEL_BUDGET = '{"maxRequests":0}';
  assertMigrationTarget(env.DATABASE_URL, identity.database, created);
  const cwd = path.join(root, "apps/api");
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
  report.stages.push({ stage, status: "passed", identityVerified: true });
  await save();
  stage = "migrate verified disposable database";
  await runCommand(["bun", "run", "db:migrate:apply"], { cwd, env, timeout: 180_000 });
  report.stages.push({ stage, status: "passed" });
  await save();
  stage = "queue state-transition integration";
  let commandFailure;
  try {
    await runCommand(["bun", "run", "scripts/verify-work-queue.ts"], {
      cwd,
      env,
      timeout: 120_000,
    });
  } catch (error) {
    commandFailure = error;
  }
  const result = JSON.parse(await readFile(env.OPENAPPLY_QUEUE_TEST_REPORT, "utf8"));
  report.stages.push({ stage, ...result });
  if (commandFailure || result.status !== "passed")
    throw new Error("Queue integration assertions failed.");
  await save();
  stage = "start model-free rendered queue verification";
  ui = await startQueueUi({ root, evidenceDir, identity, runId, env, commandFor, inGuest });
  const { observeQueueUi } = await import("./observe-ui.mjs");
  const observed = await observeQueueUi(ui, {
    webUrl: ui.webUrl,
    apiUrl: ui.apiUrl,
    cdpUrl: ui.cdpUrl,
    loginEmail: env.OPENAPPLY_QUEUE_TEST_LOGIN_EMAIL,
    password: env.OPENAPPLY_QUEUE_TEST_PASSWORD,
    jobTitle: result.ui.jobTitle,
    workItemId: result.ui.workItemId,
    outputDir: evidenceDir,
  });
  report.stages.push({ stage, ...observed });
  await save();
  if (observed.status !== "passed") throw new Error("Rendered queue verification failed.");
  await ui.assertSources();
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.stages.push({ stage, status: "failed", reason: error.message });
  process.exitCode = 1;
} finally {
  for (const resource of [ui && { stop: ui.cleanup }, bridge].filter(Boolean)) {
    try {
      await resource.stop();
    } catch (error) {
      report.status = "failed";
      report.stages.push({ stage: "cleanup", status: "failed", reason: error.message });
      process.exitCode = 1;
    }
  }
  report.databasePreserved = created;
  report.cleanup = { bridgeClosed: !(await portOpen(ports.database)), providerProcessesStarted: 0 };
  await save();
  console.log(JSON.stringify(report, null, 2));
}
