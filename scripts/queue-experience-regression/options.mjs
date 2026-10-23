import assert from "node:assert/strict";
import path from "node:path";

export function queueExperienceOptions(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = { "--run-id": "runId", "--seed-source": "seedSource", "--ui-source": "uiSource" }[
      args[i]
    ];
    assert.ok(
      key && args[i + 1] && !args[i + 1].startsWith("--"),
      "Expected --run-id and exactly one --seed-source or --ui-source.",
    );
    assert.equal(result[key], undefined, "Repeated argument.");
    result[key] = key === "runId" ? args[++i] : path.resolve(args[++i]);
  }
  assert.match(result.runId ?? "", /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.notEqual(
    Boolean(result.seedSource),
    Boolean(result.uiSource),
    "Seed and UI replay are separate runs.",
  );
  return result;
}
