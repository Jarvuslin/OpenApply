import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPhase9Evidence } from "./evidence.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function evidence() {
  return {
    mode: "model-free-queue-experience-regression",
    status: "passed",
    sourceIntegrity: "passed",
    sourceSnapshot: { database: "apply_e2e_123456789abc" },
    storageSnapshot: { sha256: "a".repeat(64) },
    seed: {
      passed: true,
      modelCalls: 0,
      providerProcesses: 0,
      employerSubmissions: 0,
      externalRequests: 0,
      executionsCreated: 0,
      seededApplications: 1,
      ui: {
        provider: "codex",
        userId: id(1),
        campaignId: id(2),
        controlId: id(3),
        controlJobId: id(4),
        blockedId: id(5),
        submittedId: id(6),
        applicationId: id(7),
        operationalQuestionId: id(9),
        itemIds: [id(3), id(5), id(6), id(10), id(11)],
        needsYouTotal: 3,
        blockedWorkCount: 1,
        pdfSha256: "b".repeat(64),
        workers: [10, 11].map((n) => ({
          workItemId: id(n),
          executionId: id(n + 10),
          browserSessionId: id(n + 20),
          workerId: id(n + 30),
        })),
      },
    },
  };
}
test("replay requires passing zero-model zero-execution synthetic source evidence", () => {
  assertPhase9Evidence(evidence());
  for (const field of [
    "modelCalls",
    "providerProcesses",
    "employerSubmissions",
    "externalRequests",
    "executionsCreated",
  ]) {
    const changed = evidence();
    changed.seed[field] = 1;
    assert.throws(() => assertPhase9Evidence(changed), field);
  }
  for (const field of ["status", "sourceIntegrity"]) {
    const changed = evidence();
    changed[field] = "failed";
    assert.throws(() => assertPhase9Evidence(changed), field);
  }
});
test("replay rejects unowned frame IDs, provider changes and malformed immutable PDF hashes", () => {
  const changes = [
    (r) => {
      r.seed.ui.provider = "claude";
    },
    (r) => {
      r.seed.ui.workers[0].workItemId = id(99);
    },
    (r) => {
      r.seed.ui.pdfSha256 = "invalid";
    },
    (r) => {
      r.seed.ui.itemIds[0] = r.seed.ui.itemIds[1];
    },
    (r) => {
      r.sourceSnapshot.database = "production";
    },
    (r) => {
      r.seed.seededApplications = 2;
    },
  ];
  for (const change of changes) {
    const changed = evidence();
    change(changed);
    assert.throws(() => assertPhase9Evidence(changed));
  }
});
