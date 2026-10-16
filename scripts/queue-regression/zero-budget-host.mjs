import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, managedProcess, portOpen, waitFor } from "../apply-e2e/processes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [dotnet, runId] = process.argv.slice(2);
if (!dotnet || !runId || !/^[a-zA-Z0-9_-]+$/.test(runId))
  throw new Error(
    "Usage: node scripts/queue-regression/zero-budget-host.mjs <dotnet-path> <unique-run-id>",
  );
const directory = path.join(root, ".temp/queue-regression", runId);
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory);
const port = 14103;
if (await portOpen(port)) throw new Error("Isolated host port is occupied.");
const requests = [];
const heartbeats = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  const presence = request.method === "POST" && request.url === "/api/runtime/presence";
  if (presence) {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      heartbeats.push(JSON.parse(body));
    });
  }
  const allowed = presence || (request.method === "GET" && request.url === "/api/auth/me");
  response.writeHead(allowed ? 200 : 403, { "content-type": "application/json" });
  response.end(allowed ? '{"id":"56ac58dc-3467-40a6-b761-55c6537816a1"}' : "{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${port}`;
const host = managedProcess(
  [dotnet, path.join(root, "apps/terminal/bin/Release/net10.0/openapply.dll")],
  {
    cwd: root,
    env: {
      ...process.env,
      OPENAPPLY_MODEL_BUDGET: '{"maxRequests":0}',
      OPENAPPLY_QUEUE_MODEL_APPROVAL: "",
      OPENAPPLY_PREPARATION_MODEL_APPROVAL: "",
      Kestrel__Endpoints__Http__Url: base,
    },
  },
);
const report = {
  status: "running",
  checks: [],
  modelCalls: 0,
  providerCommands: 0,
  databaseMutations: 0,
};
try {
  await waitFor(() => fetchJson(`${base}/healthz`), 30_000, host.assertRunning);
  const initial = await fetchJson(`${base}/queue/status`);
  assert.equal(initial.connected, false);
  assert.equal(initial.running, false);
  assert.match(initial.blockingReason, /disabled.*budget/);
  assert.deepEqual(initial.workers, []);
  assert.equal(initial.effectiveCapacity, 0);
  assert.equal(initial.budget.enabled, false);
  assert.equal(initial.budget.remainingAllocations, 0);
  report.checks.push("health and disconnected zero-budget status");
  for (const endpoint of [
    "/inference",
    "/sessions",
    "/pilot/start",
    "/connectors/gmail/check",
    "/update",
  ]) {
    const response = await fetch(`${base}${endpoint}`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 403);
  }
  report.checks.push("legacy model and scheduler entrypoints blocked");
  const connection = {
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    webUrl: "http://127.0.0.1:14100",
    apiToken: "synthetic-zero-budget-token",
  };
  for (const endpoint of ["/queue/connect"]) {
    const result = await fetchJson(`${base}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(connection),
    });
    assert.equal(result.connected, true);
    assert.equal(result.running, false);
  }
  await new Promise((resolve) => setTimeout(resolve, 4500));
  assert.equal(requests.filter((request) => request.path === "/api/auth/me").length, 2);
  assert.ok(heartbeats.length >= 1);
  assert.equal(heartbeats[0].state, "blocked");
  assert.equal(heartbeats[0].executionAvailable, false);
  assert.equal(heartbeats[0].blockingCode, "model_approval_required");
  assert.ok(
    requests.every(
      (request) =>
        (request.method === "GET" && request.path === "/api/auth/me") ||
        (request.method === "POST" && request.path === "/api/runtime/presence"),
    ),
  );
  assert.equal((await fetchJson(`${base}/queue/status`)).running, false);
  report.checks.push(
    "connected queue performs two auth checks plus blocked presence only; no claim across polling intervals",
  );
  const connected = await fetchJson(`${base}/queue/status`);
  const params = new URLSearchParams({
    expectedOwnerId: connected.ownerId,
    connectionId: connected.connectionId,
  });
  const unauthenticated = await fetch(`${base}/queue/connection?${params}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await fetchJson(`${base}/queue/status`)).connectionId, connected.connectionId);
  await fetchJson(`${base}/queue/connection?${params}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${connection.apiToken}` },
  });
  await waitFor(
    async () => {
      if (!heartbeats.some((heartbeat) => heartbeat.state === "stopped"))
        throw new Error("Waiting for stopped presence");
      return true;
    },
    5000,
    host.assertRunning,
  );
  assert.equal(requests.filter((request) => request.path === "/api/auth/me").length, 3);
  report.checks.push(
    "unauthenticated disconnect is refused; authenticated exact-generation disconnect records stopped presence without a model or queue claim",
  );
  report.status = "passed";
} catch {
  report.status = "failed";
  process.exitCode = 1;
} finally {
  await fetch(`${base}/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) }).catch(
    () => {},
  );
  await host.stop();
  await new Promise((resolve) => server.close(resolve));
  report.cleanup = { isolatedHostStopped: !(await portOpen(port)) };
  report.requests = requests;
  report.heartbeats = heartbeats;
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
