import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "./runtime.mjs";

const skip = !["win32", "darwin"].includes(process.platform)
  ? "Run helper protocol on the supported host."
  : false;
async function bounded(promise, milliseconds = 20000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Helper protocol timed out")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("real preparation helper returns while host input remains open and carries no API credentials", {
  skip,
  timeout: 30000,
}, async (t) => {
  const script =
    "const h=require('node:http');const s=h.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<form><label>Name<input name=full></label></form>');});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));process.stdin.resume();process.stdin.on('end',()=>{s.closeAllConnections();s.close(()=>process.exit());});";
  const command = guestCommand(currentRuntime(), ["node", "-e", script], "pilot");
  const server = spawn(command[0], command.slice(1), {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const serverExit = once(server, "close");
  const lines = createInterface({ input: server.stdout });
  t.after(async () => {
    server.stdin.end();
    await bounded(serverExit);
    lines.close();
  });
  const [line] = await bounded(once(lines, "line"));
  const url = `http://127.0.0.1:${JSON.parse(line).port}/form`;
  const id = randomUUID();
  const questionId = randomUUID();
  const config = {
    allowLoopback: true,
    documents: [],
    manifest: {
      job: { id, url },
      mode: "preview",
      coverage: "complete",
      submissionAllowed: false,
      questions: [
        {
          id: questionId,
          jobId: id,
          current: true,
          definition: {
            prompt: "Name",
            required: "optional",
            fields: [{ key: "full", label: "Name", type: "text", options: [] }],
          },
          answer: {
            confirmedAt: new Date().toISOString(),
            values: [{ fieldKey: "full", value: "Synthetic Person" }],
          },
        },
      ],
    },
  };
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./prepare-application.mjs", import.meta.url))],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const exited = once(child, "close");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  t.after(async () => {
    child.stdin.end();
    await bounded(exited);
  });
  child.stdin.write(`${JSON.stringify(config)}\n`);
  assert.equal((await bounded(exited))[0], 0);
  const result = JSON.parse(output);
  assert.equal(result.status, "filled");
  assert.deepEqual(result.fields, [
    { questionId, fieldKey: "full", status: "verified", value: "Synthetic Person" },
  ]);
  assert.equal(result.sourceUrl, url);
});
