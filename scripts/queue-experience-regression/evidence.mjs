import assert from "node:assert/strict";

export { assertSyntheticSnapshot } from "../telegram-regression/evidence.mjs";

export function assertPhase9Evidence(report) {
  assert.equal(report.mode, "model-free-queue-experience-regression");
  assert.equal(report.status, "passed");
  assert.equal(report.seed?.passed, true);
  assert.equal(report.sourceIntegrity, "passed");
  for (const key of ["modelCalls", "providerProcesses", "employerSubmissions", "externalRequests"])
    assert.equal(report.seed[key], 0);
  assert.equal(report.seed.executionsCreated, 0);
  assert.equal(report.seed.seededApplications, 1);
  assert.ok(report.sourceSnapshot && report.storageSnapshot);
  assert.match(report.sourceSnapshot.database, /^apply_e2e_[a-f0-9]{12}$/);
  const ui = report.seed.ui;
  assert.equal(ui.provider, "codex");
  for (const key of [
    "userId",
    "campaignId",
    "controlId",
    "controlJobId",
    "blockedId",
    "submittedId",
    "applicationId",
    "operationalQuestionId",
  ])
    assert.match(ui[key], /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(ui.itemIds.length, 5);
  assert.equal(new Set(ui.itemIds).size, 5);
  assert.equal(ui.needsYouTotal, 3);
  assert.equal(ui.blockedWorkCount, 1);
  assert.match(ui.pdfSha256, /^[a-f0-9]{64}$/);
  assert.equal(ui.workers.length, 2);
  for (const worker of ui.workers) {
    assert.ok(ui.itemIds.includes(worker.workItemId));
    for (const key of ["workItemId", "executionId", "browserSessionId", "workerId"])
      assert.match(worker[key], /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  }
}
