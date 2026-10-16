import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "./runtime.mjs";

const skip = !["win32", "darwin"].includes(process.platform)
  ? "Run the helper protocol checks on its supported host."
  : false;
function bounded(promise, milliseconds = 12_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Subprocess protocol timed out.")), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function fixture(t) {
  const script =
    "const h=require('node:http');const s=h.createServer((q,r)=>{if(q.url==='/slow'){console.log('slow-requested');return;}r.setHeader('content-type','text/html');r.end('<label for=full>Name</label><input id=full name=full required value=PRIVATE_EXISTING_ANSWER>');});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));process.stdin.resume();process.stdin.on('end',()=>{s.closeAllConnections();s.close(()=>process.exit());});";
  const command = guestCommand(currentRuntime(), ["node", "-e", script], "pilot");
  const child = spawn(command[0], command.slice(1), {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = createInterface({ input: child.stdout });
  const exited = once(child, "close");
  t.after(async () => {
    child.stdin.end();
    await bounded(exited);
    lines.close();
  });
  const [line] = await bounded(once(lines, "line"));
  return { url: `http://127.0.0.1:${JSON.parse(line).port}`, lines };
}
function helper(t, url) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./collect-questions.mjs", import.meta.url))],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const exited = once(child, "close");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdin.write(`${JSON.stringify({ url, allowLoopback: true })}\n`);
  t.after(async () => {
    child.stdin.end();
    await bounded(exited);
  });
  return { child, exited, output: () => output };
}

test("real collector helper returns observations while host stdin stays open", {
  skip,
  timeout: 30_000,
}, async (t) => {
  const server = await fixture(t);
  const process = helper(t, `${server.url}/form`);
  const [code] = await bounded(process.exited, 20_000);
  assert.equal(code, 0);
  const result = JSON.parse(process.output());
  assert.equal(result.coverage, "complete");
  assert.equal(result.definitions[0].stableKey, "fields:full");
  assert.equal(result.sourceUrl, `${server.url}/form`);
  assert.equal(process.output().includes("PRIVATE_EXISTING_ANSWER"), false);
});

test("closing host input cancels an in-flight guest collection and confirms helper exit", {
  skip,
  timeout: 30_000,
}, async (t) => {
  const server = await fixture(t);
  const requested = once(server.lines, "line");
  const process = helper(t, `${server.url}/slow`);
  assert.equal((await bounded(requested))[0], "slow-requested");
  process.child.stdin.end();
  const [code] = await bounded(process.exited, 8000);
  assert.notEqual(code, 0);
  assert.equal(process.output(), "");
});
