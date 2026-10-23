import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { workerBrowserProgram } from "./worker-browser-core.mjs";

export async function brokerFor(t) {
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
    stderr = (stderr + chunk).slice(-1000);
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve) =>
    lines.once("line", (line) => {
      assert.deepEqual(JSON.parse(line), { ready: true });
      resolve();
    }),
  );
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiting = pending.get(message.requestId);
    if (waiting) {
      pending.delete(message.requestId);
      message.ok ? waiting.resolve(message.result) : waiting.reject(Error(message.error));
    }
  });
  child.on("close", () => {
    for (const waiting of pending.values()) waiting.reject(Error("Owned broker closed"));
    pending.clear();
  });
  t.after(async () => {
    child.stdin.end();
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(Error("Owned cleanup timeout"));
          }, 10000);
        }),
      ]);
      assert.equal(child.exitCode, 0, stderr);
    } finally {
      clearTimeout(timer);
    }
  });
  child.stdin.write(JSON.stringify({ code: workerBrowserProgram() }) + "\n");
  await ready;
  return {
    send: (body) =>
      new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("Owned command timeout"));
        }, 25000);
        pending.set(requestId, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        child.stdin.write(JSON.stringify({ ...body, requestId }) + "\n");
      }),
  };
}
