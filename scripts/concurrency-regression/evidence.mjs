import assert from "node:assert/strict";

export function assertSyntheticSnapshot(snapshot) {
  assert.ok(snapshot.users?.length);
  assert.ok(
    snapshot.users.every(
      (user) =>
        user.email.endsWith("@questions.example.test") &&
        user.firstName === "Questions" &&
        user.lastName === "Fixture",
    ),
    "Concurrency replay requires synthetic fixture users.",
  );
  assert.ok(
    snapshot.applications?.every((row) => snapshot.users.some((user) => user.id === row.userId)),
    "Counter fixtures must belong only to verified synthetic users.",
  );
}

export function assertPassedDatabaseEvidence(report) {
  assert.equal(report.mode, "model-free-concurrency-regression");
  assert.equal(report.modelCalls, 0);
  assert.equal(report.providerProcesses, 0);
  assert.equal(report.employerSubmissions, 0);
  assert.equal(report.databaseResult?.passed, true);
  assert.equal(report.databaseResult?.modelRequests, 0);
  assert.equal(report.databaseResult?.employerSubmissions, 0);
  assert.ok(report.databaseResult.checks?.length > 0);
  assert.ok(report.databaseResult.ui?.userId && report.databaseResult.ui?.loginEmail);
  assert.match(report.database, /^apply_e2e_[a-f0-9]{12}$/);
}
