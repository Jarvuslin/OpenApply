import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

export async function uploadFixture(t) {
  const uploads = [];
  const html = `<!doctype html><html><body>
    <label for="resume">Choose resume</label><input id="resume" type="file" accept=".pdf">
    <div role="button" tabindex="0" aria-label="Resume dropzone" id="drop">Drop resume here</div>
    <p role="status" id="status">No resume attached</p>
    <script>
    async function attach(file) {
      if (!file) return;
      const response = await fetch('/attachment', { method: 'POST', headers: {'X-Filename': file.name}, body: await file.arrayBuffer() });
      if (response.ok) document.querySelector('#status').textContent = 'Resume attached: ' + file.name;
    }
    document.querySelector('#resume').addEventListener('change', event => attach(event.target.files[0]));
    const zone = document.querySelector('#drop');
    zone.addEventListener('dragover', event => event.preventDefault());
    zone.addEventListener('drop', event => { event.preventDefault(); attach(event.dataTransfer.files[0]); });
    </script></body></html>`;
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/attachment") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploads.push({ name: request.headers["x-filename"], bytes: Buffer.concat(chunks) });
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("attached");
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { url: `http://127.0.0.1:${server.address().port}/resume`, uploads };
}

export async function uploadMcp(t, outputDir) {
  const child = spawn(
    process.execPath,
    [
      "/home/pilot/openapply-tools/node_modules/@playwright/mcp/cli.js",
      "--headless",
      "--no-sandbox",
      "--executable-path",
      "/usr/bin/chromium",
      "--output-dir",
      outputDir,
    ],
    { cwd: outputDir, stdio: ["pipe", "pipe", "pipe"] },
  );
  let serial = 0;
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(Error(message.error.message));
    else waiting.resolve(message.result);
  });
  child.on("exit", () => {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(Error(`Upload MCP closed: ${stderr.slice(0, 300)}`));
    }
    pending.clear();
  });
  t.after(async () => {
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => child.kill(), 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    lines.close();
  });
  function request(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Upload MCP timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "openapply-upload-fixture", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const listed = await request("tools/list", {});
  for (const name of ["browser_file_upload", "browser_drop", "browser_snapshot", "browser_click"])
    assert.ok(
      listed.tools.some((tool) => tool.name === name),
      `Installed MCP lacks ${name}`,
    );
  return async (name, args = {}) => request("tools/call", { name, arguments: args });
}

export function resultText(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

export function snapshotTarget(result, label) {
  assert.ok(!result.isError, resultText(result));
  const line = resultText(result)
    .split("\n")
    .find((value) => value.includes(`"${label}"`));
  const target = line?.match(/\[ref=([^\]]+)\]/)?.[1];
  assert.ok(target, `Missing ${label} snapshot target: ${resultText(result)}`);
  return target;
}

export async function assertAttachment(call, name) {
  const result = await call("browser_snapshot");
  assert.ok(!result.isError, resultText(result));
  assert.ok(resultText(result).includes(`Resume attached: ${name}`), resultText(result));
}
