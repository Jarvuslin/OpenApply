import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("host wrapper transports ownership over stdin and acknowledges owned guest cleanup", {
  skip: process.env.OPENAPPLY_RUN_WORKER_BROWSER_TEST !== "1",
  timeout: 30000,
}, async (t) => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./worker-browser.mjs", import.meta.url))],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => {
    child.stdin.end();
    await Promise.race([
      closed,
      new Promise((resolve) =>
        setTimeout(() => {
          child.kill();
          resolve();
        }, 10000),
      ),
    ]);
  });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve) =>
    lines.once("line", (line) => {
      assert.deepEqual(JSON.parse(line), { ready: true });
      resolve();
    }),
  );
  await ready;
  const command = (body) =>
    new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const handler = (line) => {
        const result = JSON.parse(line);
        if (result.requestId !== requestId) return;
        lines.off("line", handler);
        result.ok ? resolve(result.result) : reject(Error(result.error));
      };
      lines.on("line", handler);
      child.stdin.write(`${JSON.stringify({ ...body, requestId })}\n`);
    });
  const owner = {
    runtimeId: randomUUID(),
    workerId: randomUUID(),
    executionId: randomUUID(),
    browserSessionId: randomUUID(),
    workItemId: randomUUID(),
    jobId: randomUUID(),
    url: "http://127.0.0.1:19997/synthetic-never-navigated",
    allowLoopback: true,
    headless: true,
    mode: "application",
    ttlMs: 20000,
  };
  const started = await command({ action: "start", ...owner });
  assert.ok(started.port > 1024 && started.port !== 9222);
  assert.equal(started.outputDir, `/home/pilot/openapply/queue-workers/${owner.browserSessionId}`);
  assert.deepEqual(await command({ action: "renew", mode: "application", ttlMs: 10000 }), {
    renewed: true,
  });
  child.stdin.end();
  assert.equal(await closed, 0, stderr.slice(0, 500));
});
