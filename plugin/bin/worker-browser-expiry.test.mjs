import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import test from "node:test";
import { skip } from "./preparation-test-helpers.mjs";
import { workerBrowserProgram } from "./worker-browser-core.mjs";

test("expiry during delayed Chromium startup closes the late owned process without a live timer", {
  skip,
  timeout: 20000,
}, async (t) => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const{createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});lines.once('line',async line=>{const module=await import('data:text/javascript;base64,'+Buffer.from(JSON.parse(line).code).toString('base64'));await module.default(lines);});`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
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
        }, 5000),
      ),
    ]);
  });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve) => lines.once("line", resolve));
  const original = workerBrowserProgram();
  const delayed = original.replace(
    "context = await chromium.launchPersistentContext",
    "await new Promise(resolve=>setTimeout(resolve,1500));context = await chromium.launchPersistentContext",
  );
  assert.notEqual(delayed, original);
  child.stdin.write(`${JSON.stringify({ code: delayed })}\n`);
  await ready;
  const browserSessionId = randomUUID();
  const start = {
    requestId: randomUUID(),
    action: "start",
    runtimeId: randomUUID(),
    workerId: randomUUID(),
    executionId: randomUUID(),
    browserSessionId,
    workItemId: randomUUID(),
    jobId: randomUUID(),
    url: "http://127.0.0.1:19997/synthetic-never-navigated",
    allowLoopback: true,
    headless: true,
    mode: "application",
    ttlMs: 1000,
  };
  child.stdin.write(`${JSON.stringify(start)}\n`);
  assert.equal(await closed, 0, stderr.slice(0, 500));
  const path = `--user-data-dir=/home/pilot/openapply/queue-workers/${browserSessionId}/profile`;
  const remaining = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const args = await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
    if (args.split("\0").includes(path)) remaining.push(entry);
  }
  assert.deepEqual(remaining, []);
});
