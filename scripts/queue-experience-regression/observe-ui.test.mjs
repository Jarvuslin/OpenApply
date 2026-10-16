import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { observeQueueExperienceUi } from "./observe-ui.mjs";

test("observer packaging parses without executing services and preserves explicit simulated-frame labeling", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "queue-experience-observer-"));
  try {
    let calls = 0;
    const result = await observeQueueExperienceUi(
      {
        guestCommand: async (command, options) => {
          calls++;
          assert.deepEqual(command, ["node", "--input-type=module"]);
          assert.equal(options.timeout, 300_000);
          const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
          assert.doesNotThrow(() => new AsyncFunction(options.input));
          assert.match(options.input, /1366, height: 768/);
          assert.match(options.input, /1440, height: 900/);
          assert.match(
            options.input,
            /Synthetic browser status, active-detail state, token and JPEG responses only/,
          );
          return JSON.stringify({
            status: "failed",
            failure: { stage: "synthetic-test", code: "not-executed" },
            screenshots: [],
            observations: [],
          });
        },
      },
      {
        webUrl: "http://127.0.0.1:14100",
        apiUrl: "http://127.0.0.1:14101",
        cdpUrl: "http://127.0.0.1:19222",
        companionUrl: "http://127.0.0.1:14102",
        provider: "codex",
        workers: [{}, {}],
        outputDir,
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.status, "failed");
    assert.equal(
      JSON.parse(await readFile(path.join(outputDir, "observations.json"), "utf8")).failure.code,
      "not-executed",
    );
  } finally {
    assert.equal(path.dirname(path.resolve(outputDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(outputDir).startsWith("queue-experience-observer-"));
    await rm(outputDir, { recursive: true, force: true });
  }
});
test("observer rejects remote endpoints before the guest receives a script", async () => {
  await assert.rejects(
    observeQueueExperienceUi(
      { guestCommand: () => assert.fail("must not execute") },
      {
        webUrl: "https://remote.example.test",
        apiUrl: "http://127.0.0.1:14101",
        cdpUrl: "http://127.0.0.1:19222",
        companionUrl: "http://127.0.0.1:14102",
        provider: "codex",
        workers: [{}, {}],
        outputDir: os.tmpdir(),
      },
    ),
  );
});
