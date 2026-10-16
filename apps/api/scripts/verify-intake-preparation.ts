import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "../src/common/database/prisma.client";
import { verifyPreparationCapabilities } from "./preparation-capability-regression";
import { safeTelegramFailure } from "./telegram-regression-errors";

const expected = process.env.OPENAPPLY_PREPARATION_TEST_DATABASE;
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433" ||
  url.pathname !== `/${expected}`
)
  throw new Error("Preparation regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity",
  externalRequests = 0,
  blockedProviderProcessAttempts = 0;
function report(value: Record<string, unknown>) {
  const text = JSON.stringify({
    ...value,
    checks,
    modelRequests: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    externalRequests,
    blockedProviderProcessAttempts,
  });
  if (process.env.OPENAPPLY_PREPARATION_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_PREPARATION_TEST_REPORT, text);
  console.log(text);
}
const fetchBefore = globalThis.fetch,
  spawnBefore = Bun.spawn,
  spawnSyncBefore = Bun.spawnSync;
try {
  const [identity] = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
  assert.equal(identity?.database, expected);
  assert.equal(identity?.directory, "/var/lib/postgresql/mvp");
  globalThis.fetch = Object.assign(
    async () => {
      externalRequests++;
      throw new Error("External fetch is disabled in preparation regression.");
    },
    { preconnect: fetchBefore.preconnect },
  );
  const blocked = () => {
    blockedProviderProcessAttempts++;
    throw new Error("Provider and child processes are disabled in preparation regression.");
  };
  Bun.spawn = blocked as typeof Bun.spawn;
  Bun.spawnSync = blocked as typeof Bun.spawnSync;
  const metadata = await verifyPreparationCapabilities(async (name, run) => {
    stage = name;
    await run();
    checks.push(name);
  });
  assert.equal(externalRequests, 0);
  assert.equal(blockedProviderProcessAttempts, 0);
  report({ passed: true, mode: "database", metadata });
} catch (error) {
  report({ passed: false, stage, failure: safeTelegramFailure(error) });
  process.exitCode = 1;
} finally {
  globalThis.fetch = fetchBefore;
  Bun.spawn = spawnBefore;
  Bun.spawnSync = spawnSyncBefore;
  await db.$disconnect();
}
