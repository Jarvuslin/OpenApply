import assert from "node:assert/strict";
import { test } from "node:test";
import { queueExperienceOptions } from "./options.mjs";

test("seeding and replay are exclusive and require a fresh simple ID", () => {
  assert.ok(queueExperienceOptions(["--run-id", "phase9-a", "--seed-source", "source"]).seedSource);
  assert.ok(queueExperienceOptions(["--run-id", "phase9-b", "--ui-source", "source"]).uiSource);
  for (const args of [
    [],
    ["--run-id", "../escape", "--seed-source", "source"],
    ["--run-id", "a"],
    ["--run-id", "a", "--seed-source", "source", "--ui-source", "source"],
    ["--run-id", "a", "--seed-source", "source", "--database-only"],
    ["--run-id", "a", "--run-id", "b", "--ui-source", "source"],
  ])
    assert.throws(() => queueExperienceOptions(args));
});
