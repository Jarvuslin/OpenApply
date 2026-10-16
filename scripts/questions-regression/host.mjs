import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { currentRuntime, guestCommand } from "../../plugin/bin/runtime.mjs";
import { fetchJson, managedProcess, portOpen, waitFor } from "../apply-e2e/processes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [dotnet, runId] = process.argv.slice(2);
if (!dotnet || !/^[a-zA-Z0-9_-]+$/.test(runId ?? ""))
  throw new Error("Pass the .NET executable and a new run ID.");
const directory = path.join(root, ".temp/questions-regression", runId);
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory);
const port = 14103;
if (await portOpen(port)) throw new Error("Dedicated question host port is occupied.");
const requests = [];
const fixtureRequests = [];
const token = randomUUID();
const jobId = randomUUID();
let version = 0;
let observations;
let held = true;
let releaseRead;
const readGate = new Promise((resolve) => {
  releaseRead = resolve;
});
const fixtureScript =
  "const h=require('node:http');const s=h.createServer((q,r)=>{console.log(JSON.stringify({method:q.method,path:q.url}));r.setHeader('content-type','text/html');r.end('<label for=full>Name</label><input id=full name=full required value=PRIVATE_EXISTING_ANSWER>');});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));process.stdin.resume();process.stdin.on('end',()=>{s.closeAllConnections();s.close(()=>process.exit());});";
const guest = managedProcess(
  guestCommand(currentRuntime(), ["node", "-e", fixtureScript], "pilot"),
  { protocol: true, requireCleanExit: true },
);
const lines = createInterface({ input: guest.child.stdout });
let fixturePort;
lines.on("line", (line) => {
  const entry = JSON.parse(line);
  if (entry.port) fixturePort = entry.port;
  else fixtureRequests.push(entry);
});
let host;
let server;
const report = {
  status: "running",
  checks: [],
  modelCalls: 0,
  providerCommands: 0,
  databaseMutations: 0,
  employerSubmissions: 0,
};
try {
  await waitFor(() => fixturePort, 10_000, guest.assertRunning);
  const url = `http://127.0.0.1:${fixturePort}/form`;
  const snapshot = () => ({
    job: { id: jobId, url },
    collectionVersion: version,
    latestCollection: observations
      ? { coverage: observations.coverage, reason: observations.reason ?? null }
      : null,
    questions: observations?.definitions ?? [],
  });
  server = createServer(async (request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    if (request.method === "GET" && request.url === `/api/jobs/${jobId}/questions`) {
      if (held) await readGate;
      response.end(JSON.stringify(snapshot()));
      return;
    }
    if (request.method === "PUT" && request.url === `/api/jobs/${jobId}/questions/observations`) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const candidate = JSON.parse(body);
      if (candidate.expectedCollectionVersion !== version) {
        response.writeHead(409);
        response.end("{}");
        return;
      }
      observations = candidate;
      version++;
      response.end(JSON.stringify(snapshot()));
      return;
    }
    response.writeHead(403);
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port}`;
  host = managedProcess(
    [dotnet, path.join(root, "apps/terminal/bin/Release/net10.0/openapply.dll")],
    {
      cwd: root,
      env: {
        ...process.env,
        OPENAPPLY_MODEL_BUDGET: '{"maxRequests":0}',
        OPENAPPLY_QUESTION_ALLOW_LOOPBACK: "1",
        Kestrel__Endpoints__Http__Url: base,
      },
    },
  );
  await waitFor(() => fetchJson(`${base}/healthz`), 30_000, host.assertRunning);
  const initial = await fetchJson(`${base}/queue/status`);
  assert.equal(initial.connected, false);
  assert.match(initial.blockingReason, /disabled.*budget/);
  const request = {
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    apiToken: token,
    jobId,
    requestId: randomUUID(),
    expectedCollectionVersion: 0,
  };
  const collect = (body = request) =>
    fetch(`${base}/questions/collect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  const pending = collect();
  await waitFor(() => requests.length === 1, 5000, host.assertRunning);
  assert.equal((await collect({ ...request, requestId: randomUUID() })).status, 409);
  assert.equal(requests.length, 1);
  report.checks.push(
    "Concurrent collection rejected before API/browser access by shared runtime gate",
  );
  held = false;
  releaseRead();
  const response = await pending;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.jobId, jobId);
  assert.equal(result.collectionVersion, 1);
  assert.equal(result.coverage, "complete");
  assert.equal(result.questionCount, 1);
  assert.equal(observations.source, "browser_dom");
  assert.equal(observations.sourceUrl, url);
  assert.equal(observations.requestId, request.requestId);
  assert.equal(observations.expectedCollectionVersion, 0);
  assert.equal(observations.definitions[0].stableKey, "fields:full");
  assert.equal(observations.definitions[0].required, "required");
  assert.equal(JSON.stringify(observations).includes("PRIVATE_EXISTING_ANSWER"), false);
  assert.equal(JSON.stringify(observations).includes(token), false);
  report.checks.push(
    "Real zero-budget host fetched owned job, collected a fixed DOM definition and PUT exact versioned provenance without answer values",
  );
  assert.equal((await collect({ ...request, requestId: randomUUID() })).status, 409);
  assert.equal(fixtureRequests.length, 1);
  report.checks.push(
    "Stale collection rejected after owned GET without another browser visit or PUT",
  );
  assert.equal(
    (
      await collect({
        ...request,
        apiToken: "invalid-synthetic-token",
        expectedCollectionVersion: 1,
      })
    ).status,
    502,
  );
  assert.equal(fixtureRequests.length, 1);
  report.checks.push("Authentication failure returns actionable error without browser launch");
  for (const endpoint of ["/inference", "/sessions", "/pilot/start", "/connectors/gmail/check"])
    assert.equal((await fetch(`${base}${endpoint}`, { method: "POST" })).status, 403);
  const final = await fetchJson(`${base}/queue/status`);
  assert.equal(final.connected, false);
  assert.equal(final.running, false);
  assert.match(final.blockingReason, /disabled.*budget/);
  assert.equal(requests.length, 4);
  assert.equal(requests.filter((entry) => entry.method === "PUT").length, 1);
  assert(requests.every((entry) => entry.path.startsWith(`/api/jobs/${jobId}/questions`)));
  assert(fixtureRequests.every((entry) => entry.method === "GET" && entry.path === "/form"));
  report.checks.push(
    "Queue remains disconnected/budget-blocked; no claims, provider entrypoints, scheduler calls or form submissions",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof assert.AssertionError
      ? error.message
      : "Code-only host smoke failed; no model retry was attempted.";
  process.exitCode = 1;
} finally {
  held = false;
  releaseRead();
  if (host) {
    await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
    await host.stop();
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await guest.stop();
  lines.close();
  report.cleanup = {
    isolatedHostStopped: !(await portOpen(port)),
    guestFixtureStopped: true,
    fakeApiStopped: true,
  };
  report.apiRequests = requests.map((entry) => ({
    method: entry.method,
    path: entry.path.replace(jobId, "synthetic-job"),
  }));
  report.fixtureRequests = fixtureRequests;
  await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      modelCalls: 0,
      report: path.join(directory, "report.json"),
    }),
  );
}
