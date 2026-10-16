import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("account MCP exposes only six scoped operations and never retries refused calls", async (t) => {
  const requests = [];
  const capability = "a".repeat(64);
  const session = randomUUID();
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({
      url: req.url,
      method: req.method,
      capability: req.headers["x-openapply-worker-capability"],
      body: JSON.parse(body),
    });
    res.writeHead(requests.length === 1 ? 200 : 409, { "content-type": "application/json" });
    res.end(JSON.stringify({ phase: "signup", submissionAllowed: false }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./account-mcp.mjs", import.meta.url))],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENAPPLY_COMPANION: `http://127.0.0.1:${server.address().port}`,
        OPENAPPLY_BROWSER_SESSION_ID: session,
        OPENAPPLY_WORKER_CAPABILITY: capability,
      },
    },
  );
  const pending = new Map();
  let sequence = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response.result);
    pending.delete(response.id);
  });
  t.after(() => {
    child.kill();
    server.closeAllConnections();
    server.close();
    assert.equal(stderr, "");
  });
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++sequence;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  assert.equal((await send("initialize")).serverInfo.name, "openapply_account");
  assert.deepEqual(
    (await send("tools/list")).tools.map((tool) => tool.name),
    ["inspect", "signup", "login", "verification_context", "verify", "request_help"],
  );
  for (const name of ["evaluate", "click", "Bash", "submit_application", "read_credential"])
    assert.equal((await send("tools/call", { name, arguments: {} })).isError, true);
  assert.equal(
    (
      await send("tools/call", {
        name: "inspect",
        arguments: { target: "https://elsewhere.example" },
      })
    ).isError,
    true,
  );
  assert.equal(requests.length, 0);
  const result = await send("tools/call", { name: "inspect", arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).submissionAllowed, false);
  assert.deepEqual(requests[0], {
    url: `/queue/workers/${session}/account`,
    method: "POST",
    capability,
    body: { operation: "inspect", input: {} },
  });
  assert.equal((await send("tools/call", { name: "signup", arguments: {} })).isError, true);
  assert.equal(requests.length, 2);
});
