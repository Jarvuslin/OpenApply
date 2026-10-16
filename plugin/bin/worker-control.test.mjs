import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { browserCommands } from "./browser-options.mjs";
import { workerControl } from "./worker-control.mjs";

test("worker attachment has no shared browser fallback or credential in URL/body", async () => {
  let calls = 0;
  await assert.rejects(
    workerControl("attach", {}, async () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
  assert.throws(() => browserCommands({ OPENAPPLY_WORK_ITEM_ID: randomUUID() }));
  const session = randomUUID(),
    capability = "a".repeat(64);
  const environment = {
    OPENAPPLY_COMPANION: "http://127.0.0.1:14103",
    OPENAPPLY_BROWSER_SESSION_ID: session,
    OPENAPPLY_WORKER_CAPABILITY: capability,
  };
  const result = await workerControl("attach", environment, async (url, options) => {
    calls++;
    assert.ok(!url.includes(capability));
    assert.equal(options.body, undefined);
    assert.equal(options.headers["X-OpenApply-Worker-Capability"], capability);
    assert.equal(options.redirect, "error");
    return new Response(
      JSON.stringify({
        browserSessionId: session,
        port: 19555,
        outputDir: `/home/pilot/openapply/queue-workers/${session}`,
      }),
    );
  });
  assert.equal(result.port, 19555);
  assert.equal(calls, 1);
  for (const port of [9222, 0, 65536])
    await assert.rejects(
      workerControl(
        "attach",
        environment,
        async () => new Response(JSON.stringify({ ...result, port })),
      ),
    );
  await assert.rejects(
    workerControl(
      "attach",
      { ...environment, OPENAPPLY_COMPANION: "https://example.com" },
      async () => {
        throw Error("must not fetch");
      },
    ),
  );
});
