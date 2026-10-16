import assert from "node:assert/strict";
import test from "node:test";
import { questionRegressionOptions } from "./options.mjs";

test("question regression separates database and preserved-evidence UI stages", () => {
  assert.deepEqual(questionRegressionOptions(["--run-id", "questions-a", "--database-only"]), {
    databaseOnly: true,
    runId: "questions-a",
  });
  assert.ok(questionRegressionOptions(["--run-id", "ui-a", "--ui-source", "evidence"]).uiSource);
  assert.throws(() => questionRegressionOptions(["--run-id", "../unsafe"]));
  assert.throws(() => questionRegressionOptions(["--run-id", "ok", "--provider", "claude"]));
  assert.throws(() => questionRegressionOptions(["--run-id", "ok", "--approval-file", "x"]));
  assert.throws(() =>
    questionRegressionOptions(["--run-id", "ok", "--ui-source", "x", "--database-only"]),
  );
});
