import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import test from "node:test";
import { manifestFor, skip } from "./preparation-test-helpers.mjs";
import { workerBrowserProgram } from "./worker-browser-core.mjs";

test("three owned Chromium processes isolate forms and retain guarded preparation until scoped release", {
  skip,
  timeout: 60000,
}, async (t) => {
  const modulePath = "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs";
  const { chromium } = await import(modulePath);
  let posts = 0;
  const html =
    '<form><label for="full_name">Full name</label><input id="full_name" name="full_name" required><button type="submit">Submit</button></form>';
  const server = createServer((request, response) => {
    if (request.method === "POST") posts++;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/form`;
  const runtimeId = randomUUID();
  const workers = [];
  for (let index = 0; index < 3; index++) {
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
    t.after(async () => {
      child.stdin.end();
      await Promise.race([
        new Promise((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("close", resolve);
        }),
        new Promise((resolve) =>
          setTimeout(() => {
            child.kill();
            resolve();
          }, 5000),
        ),
      ]);
    });
    const pending = new Map();
    child.on("close", () => {
      for (const waiting of pending.values())
        waiting.reject(Error("Broker closed: " + stderr.slice(0, 500)));
      pending.clear();
    });
    const lines = createInterface({ input: child.stdout });
    const ready = new Promise((resolve) =>
      lines.once("line", (line) => {
        assert.deepEqual(JSON.parse(line), { ready: true });
        resolve();
      }),
    );
    lines.on("line", (line) => {
      const response = JSON.parse(line);
      const waiting = pending.get(response.requestId);
      if (waiting) {
        pending.delete(response.requestId);
        response.ok ? waiting.resolve(response.result) : waiting.reject(Error(response.error));
      }
    });
    child.stdin.write(JSON.stringify({ code: workerBrowserProgram() }) + "\n");
    await Promise.race([
      ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Broker readiness timed out: " + stderr.slice(0, 300))),
          10000,
        ),
      ),
    ]);
    t.diagnostic(`worker ${index} ready`);
    const send = (body) =>
      new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("Broker " + body.action + " timed out: " + stderr.slice(0, 500)));
        }, 25000);
        pending.set(requestId, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        child.stdin.write(JSON.stringify({ ...body, requestId }) + "\n");
      });
    const owner = {
      runtimeId,
      workerId: randomUUID(),
      executionId: randomUUID(),
      browserSessionId: randomUUID(),
      workItemId: randomUUID(),
      jobId: randomUUID(),
      url,
      allowLoopback: true,
      headless: true,
      mode: "application",
      ttlMs: 60000,
    };
    const started = await send({ ...owner, action: "start" });
    t.diagnostic(`worker ${index} started`);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${started.port}`);
    const context = browser.contexts()[0],
      page = context.pages()[0];
    t.after(async () => {
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("close", resolve);
      });
      assert.equal(child.exitCode, 0, stderr.slice(0, 500));
    });
    workers.push({ owner, started, send, child, browser, context, page });
  }
  assert.equal(new Set(workers.map((worker) => worker.started.port)).size, 3);
  assert.equal(new Set(workers.map((worker) => worker.started.outputDir)).size, 3);
  for (const [index, worker] of workers.entries()) {
    await worker.context.addCookies([{ name: "isolation", value: String(index), url }]);
    await worker.page.setContent(html);
    const manifest = await manifestFor(worker.page, { full_name: `Synthetic ${index}` }, url);
    manifest.job.id = worker.owner.jobId;
    manifest.mode = "worker";
    manifest.manifestHash = String(index + 1).repeat(64);
    for (const question of manifest.questions) question.jobId = worker.owner.jobId;
    const result = await worker.send({
      action: "prepare",
      config: { manifest, documents: [], allowLoopback: true },
    });
    t.diagnostic(`worker ${index} prepared`);
    assert.equal(result.fields[0].status, "verified");
    assert.equal(await worker.page.locator("input").inputValue(), `Synthetic ${index}`);
    assert.equal(
      (await worker.context.cookies()).find((cookie) => cookie.name === "isolation").value,
      String(index),
    );
    assert.equal(
      await worker.page.evaluate(async () => {
        try {
          await fetch("/probe", { method: "POST" });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    worker.hash = manifest.manifestHash;
    const frame = await worker.send({
      action: "frame",
      workItemId: worker.owner.workItemId,
      executionId: worker.owner.executionId,
      browserSessionId: worker.owner.browserSessionId,
    });
    assert.equal(frame.mimeType, "image/jpeg");
    assert.ok(Buffer.from(frame.imageBase64, "base64").length <= 640000);
    assert.equal(frame.width, 1280);
    assert.equal(frame.height, 720);
    assert.equal(frame.workItemId, worker.owner.workItemId);
    assert.ok(Date.now() - Date.parse(frame.capturedAt) < 5000);
    await assert.rejects(
      worker.send({
        action: "frame",
        workItemId: worker.owner.workItemId,
        executionId: randomUUID(),
        browserSessionId: worker.owner.browserSessionId,
      }),
    );
  }
  assert.equal(posts, 0);
  await assert.rejects(workers[0].send({ action: "handoff", manifestHash: "0".repeat(64) }));
  const handoff = await workers[0].send({ action: "handoff", manifestHash: workers[0].hash });
  assert.equal(handoff.submissionAllowed, false);
  await workers[0].page.goto(url);
  await workers[0].page.waitForFunction(() => window.__openapplyPreparationFrozen === false);
  await workers[0].page.evaluate(() => fetch("/synthetic-network-probe", { method: "POST" }));
  assert.equal(posts, 1);
  assert.equal(
    await workers[1].page.evaluate(async () => {
      try {
        await fetch("/probe", { method: "POST" });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  workers[0].child.stdin.end();
  await new Promise((resolve) => workers[0].child.once("close", resolve));
  assert.equal(await workers[1].page.locator("input").inputValue(), "Synthetic 1");
  assert.equal(await workers[2].page.locator("input").inputValue(), "Synthetic 2");
  await workers[2].send({ action: "renew", mode: "application", ttlMs: 1000 });
  await new Promise((resolve) => workers[2].child.once("close", resolve));
  assert.equal(await workers[1].page.locator("input").inputValue(), "Synthetic 1");
});
