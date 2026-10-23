import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { runCommand } from "../apply-e2e/processes.mjs";
import { assertDatabaseUnchanged, databaseFingerprint } from "../apply-e2e/ui-database.mjs";
import { assertSeparateUiOutput } from "../apply-e2e/ui-run.mjs";
import { cloneStorage, storageFingerprint } from "../preparation-regression/storage.mjs";
import { assertPassedDatabaseEvidence, assertSyntheticSnapshot } from "./evidence.mjs";

const [sourceFlag, input, runFlag, runId, ...extra] = process.argv.slice(2);
assert.equal(sourceFlag, "--source");
assert.equal(runFlag, "--run-id");
assert.match(runId ?? "", /^[a-z0-9][a-z0-9-]{0,63}$/);
assert.equal(extra.length, 0);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.resolve(input);
const output = path.join(root, ".temp/concurrency-regression", runId);
await assertSeparateUiOutput(source, output);
const sourceBytes = await readFile(path.join(source, "report.json"));
const previous = JSON.parse(sourceBytes);
assertPassedDatabaseEvidence(previous);
assert.equal(previous.status, "failed");
assert.equal(
  previous.stages.at(-1)?.reason,
  "Concurrency database assertions failed; see database-checks.json.",
);
assert.equal(previous.cleanup?.bridgeClosed, true);
assert.equal(previous.cleanup?.providerProcessesStarted, 0);
const runtime = currentRuntime();
const inGuest = (command, options) => runCommand(guestCommand(runtime, command), options);
const before = await databaseFingerprint(inGuest, previous.database);
assertSyntheticSnapshot(before);
const storage = await storageFingerprint(path.join(source, "storage"));
await mkdir(output);
await cloneStorage(path.join(source, "storage"), path.join(output, "storage"), storage);
assert.deepEqual(await storageFingerprint(path.join(source, "storage")), storage);
assertDatabaseUnchanged(before, await databaseFingerprint(inGuest, previous.database));
assert.deepEqual(await readFile(path.join(source, "report.json")), sourceBytes);
const report = {
  version: 1,
  mode: previous.mode,
  runId,
  database: previous.database,
  status: "passed",
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  databaseResult: previous.databaseResult,
  sourceSnapshot: before,
  storageSnapshot: storage,
  sourceIntegrity: "passed",
  databasePreserved: true,
  recoveredFrom: {
    runId: previous.runId,
    reportSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    reason:
      "The verifier passed every database assertion; the outer runner expected a different success field.",
  },
  stages: [
    {
      stage: "read-only capture of passed database evidence",
      status: "passed",
      migrations: 0,
      databaseWrites: 0,
      repeatedDatabaseTests: 0,
    },
  ],
  cleanup: { bridgeClosed: true, providerProcessesStarted: 0 },
};
await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    status: report.status,
    runId,
    database: previous.database,
    repeatedDatabaseTests: 0,
    modelCalls: 0,
    output,
  }),
);
