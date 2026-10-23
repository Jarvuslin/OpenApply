import assert from "node:assert/strict";
import test from "node:test";
import { assertPassedDatabaseEvidence } from "./evidence.mjs";

const report = () => ({
  mode: "model-free-concurrency-regression",
  modelCalls: 0,
  providerProcesses: 0,
  employerSubmissions: 0,
  database: "apply_e2e_000000000000",
  databaseResult: {
    passed: true,
    modelRequests: 0,
    employerSubmissions: 0,
    checks: ["assertion passed"],
    ui: { userId: "synthetic", loginEmail: "fixture" },
  },
});
test("successful database stage is independent from a later wrapper failure", () => {
  assert.doesNotThrow(() => assertPassedDatabaseEvidence({ ...report(), status: "failed" }));
  for (const mutate of [
    (r) => {
      r.databaseResult.passed = false;
    },
    (r) => {
      r.modelCalls = 1;
    },
    (r) => {
      r.providerProcesses = 1;
    },
    (r) => {
      delete r.databaseResult.ui;
    },
    (r) => {
      r.database = "production";
    },
  ]) {
    const changed = report();
    mutate(changed);
    assert.throws(() => assertPassedDatabaseEvidence(changed));
  }
});
