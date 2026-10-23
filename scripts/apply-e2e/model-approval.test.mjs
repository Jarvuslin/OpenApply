import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claimApproval, validateApproval } from "./model-approval.mjs";
import { run } from "./run.mjs";

const now = Date.parse("2026-10-08T18:00:00Z");
function approval() {
  return {
    version: 1,
    approved: true,
    runId: "unit-only",
    approvalReference: "unit-test-not-user-approval",
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    provider: "claude",
    model: "sonnet",
    cases: ["greenhouse"],
    maxCampaigns: 1,
    maxAutomaticRetries: 0,
    budget: {
      maxRequests: 10,
      maxTokens: 100000,
      maxSubagents: 1,
      maxTurns: 3,
      maxWorkerTurns: 3,
      maxSeconds: 60,
      maxBudgetUsd: 1,
    },
  };
}

test("default acceptance denies before creating an evidence directory or running preflight", async () => {
  const directory = join(await mkdtemp(join(os.tmpdir(), "approval-denied-")), "no-run");
  await assert.rejects(
    run(["--run-id", "unit-only", "--evidence-dir", directory]),
    /Model execution is disabled/,
  );
  await assert.rejects(readFile(join(directory, "report.json")), { code: "ENOENT" });
});

test("disabled acceptance runner refuses an approval file without consuming it", async () => {
  const directory = await mkdtemp(join(os.tmpdir(), "queue-acceptance-denied-"));
  const file = join(directory, "approval.json");
  const evidence = join(directory, "no-run");
  const body = JSON.stringify(approval());
  await writeFile(file, body);
  await assert.rejects(
    run(["--run-id", "unit-only", "--evidence-dir", evidence, "--approval-file", file]),
    /adapted to common-queue dispatch and campaign-wide budgets/,
  );
  assert.equal(await readFile(file, "utf8"), body);
  await assert.rejects(readFile(`${file}.used`), { code: "ENOENT" });
  await assert.rejects(readFile(join(evidence, "report.json")), { code: "ENOENT" });
});

test("approval binds case scope, model, run, expiry and all finite budgets", () => {
  const good = approval();
  assert.deepEqual(validateApproval(good, "unit-only", now).cases, ["greenhouse"]);
  for (const change of [
    { approved: false },
    { provider: "codex" },
    { model: "haiku" },
    { maxCampaigns: 2 },
    { maxAutomaticRetries: 1 },
    { cases: [] },
    { cases: ["greenhouse", "greenhouse"] },
    { expiresAt: new Date(now).toISOString() },
    { approvedAt: new Date(now + 1).toISOString() },
  ])
    assert.throws(() => validateApproval({ ...good, ...change }, "unit-only", now));
  assert.throws(() => validateApproval(good, "another-run", now));
  for (const key of Object.keys(good.budget)) {
    const budget = { ...good.budget };
    delete budget[key];
    assert.throws(() => validateApproval({ ...good, budget }, "unit-only", now));
  }
  assert.throws(() =>
    validateApproval(
      { ...good, budget: { ...good.budget, maxRequests: Infinity } },
      "unit-only",
      now,
    ),
  );
});

test("one-use approval is atomically claimed and cannot authorize a retry", async () => {
  const directory = await mkdtemp(join(os.tmpdir(), "approval-claim-"));
  const file = join(directory, "unit.json");
  const claims = join(directory, "claims");
  await writeFile(file, JSON.stringify(approval()));
  const results = await Promise.allSettled([
    claimApproval(file, "unit-only", now, claims),
    claimApproval(file, "unit-only", now, claims),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  await assert.rejects(claimApproval(file, "unit-only", now, claims), { code: "EEXIST" });
  assert.equal(JSON.parse(await readFile(`${file}.used`, "utf8")).runId, "unit-only");
  const copy = join(directory, "copied.json");
  await writeFile(copy, await readFile(file));
  await assert.rejects(claimApproval(copy, "unit-only", now, claims), { code: "EEXIST" });
});
