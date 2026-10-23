import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { provisionEnvironment } from "../apply-e2e/environment.mjs";
import { createQueueApi } from "./api.mjs";
import { exactQueueGrant, validateQueueTestApproval } from "./approval.mjs";
import { finalRunChecks } from "./evidence.mjs";
import { recordedHandback, startEvidenceObserver } from "./observer.mjs";
import {
  assertPreparedWork,
  assertPristineFixture,
  subscriptionConfiguration,
} from "./preflight.mjs";
import { options, pollQueue } from "./run.mjs";

function approval() {
  return {
    version: 1,
    approved: true,
    purpose: "queue-application-test",
    runId: randomUUID(),
    provider: "claude",
    model: "sonnet",
    approvalReference: "test:explicit-user-approval",
    approvedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxCampaigns: 1,
    maxAutomaticRetries: 0,
    cases: ["greenhouse"],
    acceptObservedLimitOvershoot: true,
    budget: {
      maxRequests: 60,
      maxTokens: 2_000_000,
      maxSubagents: 4,
      maxTurns: 20,
      maxWorkerTurns: 50,
      maxBudgetUsd: 3,
      maxSeconds: 600,
    },
  };
}

function pollContext() {
  const connection = { ownerId: "synthetic-owner", connectionId: "connection" };
  const execution = { workItemId: "one", executionId: "execution", browserSessionId: "browser" };
  return {
    connection,
    execution: () => execution,
    readRuntime: async () => ({
      ...connection,
      connected: true,
      running: false,
      workers: [],
      lastError: null,
    }),
  };
}

test("exact one-case grant preserves approved finite ceilings and rejects scope changes", () => {
  const input = approval();
  const validated = validateQueueTestApproval(input, input.runId);
  const workId = randomUUID();
  const grant = exactQueueGrant(validated, workId);
  assert.deepEqual(grant.budget, input.budget);
  assert.deepEqual(grant.allocations[0].budget, input.budget);
  assert.equal(grant.allocations[0].workItemId, workId);
  assert.equal(grant.maxConcurrentWorkers, 1);
  assert.equal(grant.maxAutomaticRetries, 0);
  for (const patch of [
    { cases: ["greenhouse", "lever"] },
    { purpose: "legacy" },
    { acceptObservedLimitOvershoot: false },
    { provider: "codex" },
    { maxAutomaticRetries: 1 },
    { model: "haiku" },
    { budget: { ...input.budget, maxRequests: 0 } },
  ])
    assert.throws(() => validateQueueTestApproval({ ...input, ...patch }, input.runId));
});

test("CLI does not infer live authorization or accept legacy execution flags", async () => {
  assert.deepEqual(options(["--preflight"]), { preflight: true });
  for (const args of [[], ["--execute"], ["--run-id", randomUUID()], ["--preflight", "yes"]])
    assert.throws(() => options(args));
  await assert.rejects(provisionEnvironment({}), /claimed one-use approval/);
});

test("model-free API client cannot write submission state or mutate prepared inputs after sealing", async () => {
  const calls = [];
  const api = createQueueApi("http://127.0.0.1:14101", {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response("{}");
    },
  });
  await api.request("/api/score-fit/context", { method: "POST", body: {} });
  await api.request("/api/score-fit/", { method: "POST", body: {} });
  for (const suffix of [
    "submission-begin",
    "submission-checkpoint",
    "submission-receipt",
    "result",
    "worker-result-check",
  ])
    await assert.rejects(
      api.request(`/api/campaigns/test/jobs/test/${suffix}`, { method: "POST", body: {} }),
      /forbidden/,
    );
  api.finishSeeding();
  await assert.rejects(api.request("/api/score-fit/", { method: "POST", body: {} }), /forbidden/);
  await assert.rejects(api.request("https://outside.example/api/user/"), /loopback/);
  assert.equal(calls.length, 2);
});

test("subscription-only checks refuse alternate routes and stored API billing credentials", () => {
  const credentials = { claudeAiOauth: { subscriptionType: "pro" } };
  assert.equal(subscriptionConfiguration({}, {}, credentials).modelCalls, 0);
  for (const name of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ])
    assert.throws(() => subscriptionConfiguration({ [name]: "not-logged" }, {}, credentials));
  assert.throws(() => subscriptionConfiguration({}, { primaryApiKey: "not-logged" }, credentials));
  assert.throws(() => subscriptionConfiguration({}, {}, {}));
});

test("prior submissions, rejected submit requests, missing fit and blocked work stop before execution", () => {
  assertPristineFixture({ submissions: [], submissionRequests: {} });
  for (const value of [
    { submissions: [{}] },
    { submissions: [], submissionRequests: { greenhouse: 1 } },
  ])
    assert.throws(() => assertPristineFixture(value), /cannot be replayed/);
  const fixture = {
    url: "http://127.0.0.1/job",
    title: "Synthetic",
    company: "Fixture",
    description: "Full fixture posting",
  };
  const job = { ...fixture, fitAssessment: {}, matchScore: 70 };
  const ordered = { items: [{ workItemId: "exact", eligible: true }] };
  assertPreparedWork(job, fixture, null, ordered, "exact");
  assert.throws(
    () => assertPreparedWork(job, fixture, { startedAt: "previous" }, ordered, "exact"),
    /recovery/,
  );
  assert.throws(
    () => assertPreparedWork({ ...job, fitAssessment: null }, fixture, null, ordered, "exact"),
    /missing/,
  );
  assert.throws(
    () =>
      assertPreparedWork(
        job,
        fixture,
        null,
        { items: [{ workItemId: "other", eligible: true }] },
        "exact",
      ),
    /blocked/,
  );
});

test("terminal queue states and transport failure never trigger another application or retry", async () => {
  const calls = [];
  let index = 0;
  const api = {
    request: async (url) => {
      calls.push(url);
      return { item: { state: ["preparing", "needs_user"][index++] } };
    },
  };
  const result = await pollQueue(api, "one", {
    ...pollContext(),
    timeoutMs: 100,
    assertHealthy: async () => {},
    sleep: async () => {},
    now: () => 0,
  });
  assert.equal(result.item.state, "needs_user");
  assert.deepEqual(calls, ["/api/work-queue/one", "/api/work-queue/one"]);
  let requests = 0;
  await assert.rejects(
    pollQueue(
      {
        ...pollContext(),
        request: async () => {
          requests++;
          throw new Error("transport");
        },
      },
      "one",
      {
        timeoutMs: 100,
        assertHealthy: async () => {},
        sleep: async () => {},
        now: () => 0,
      },
    ),
    /transport/,
  );
  assert.equal(requests, 1);
});

test("submitted evidence waits for the exact worker to finish and drain before cleanup", async () => {
  const context = pollContext();
  let polls = 0;
  let handbackPresent = false;
  const calls = [];
  const result = await pollQueue(
    {
      request: async (url) => {
        calls.push(url);
        if (url.includes("/observer?")) {
          assert.equal(handbackPresent, true);
          return {
            ...context.execution(),
            ownerId: context.connection.ownerId,
            currentExecutionId: "execution",
            state: "submitted",
            active: false,
            leaseExpiresAt: null,
          };
        }
        return { item: { state: "submitted" } };
      },
    },
    "one",
    {
      ...context,
      timeoutMs: 100,
      assertHealthy: async () => {},
      now: () => 0,
      sleep: async () => {
        assert.equal(handbackPresent, false, "polling must continue before worker handback");
      },
      readRuntime: async () => {
        polls++;
        const workers =
          polls < 3
            ? [{ ...context.execution(), state: polls === 1 ? "running" : "stopping" }]
            : [];
        if (polls === 3) handbackPresent = true;
        return {
          ...context.connection,
          connected: true,
          running: workers.length > 0,
          workers,
          lastError: null,
        };
      },
    },
  );
  assert.equal(polls, 3);
  assert.equal(handbackPresent, true);
  assert.equal(result.runtimeSettlement.state, "worker_drained");
  assert.equal(result.runtimeSettlement.executionId, "execution");
  assert.equal(result.runtimeSettlement.lastError, null);
  assert.equal(result.runtimeSettlement.canonicalObserver.state, "submitted");
  assert.deepEqual(calls, [
    ...Array(3).fill("/api/work-queue/one"),
    "/api/work-queue/one/observer?executionId=execution&browserSessionId=browser",
  ]);
});

test("a drained failed worker returns retained state without inventing handback or retry", async () => {
  const context = pollContext();
  let requests = 0;
  const result = await pollQueue(
    {
      request: async () => {
        requests++;
        return { item: { state: "failed" } };
      },
    },
    "one",
    { ...context, timeoutMs: 100, assertHealthy: async () => {} },
  );
  assert.equal(requests, 1);
  assert.equal(result.item.state, "failed");
  assert.equal(result.workerEvidence, undefined);
  assert.equal(result.runtimeSettlement.state, "worker_drained");
});

test("settlement refuses unknown or changed execution ownership and keeps a finite deadline", async () => {
  const context = pollContext();
  const runtime = {
    ...context.connection,
    connected: true,
    running: true,
    workers: [{ ...context.execution(), state: "running" }],
  };
  const api = { request: async () => ({ item: { state: "submitted" } }) };
  for (const change of [
    (copy) => {
      copy.workers[0].workItemId = "different";
    },
    (copy) => {
      copy.workers[0].executionId = "different";
    },
    (copy) => {
      copy.workers[0].browserSessionId = "different";
    },
    (copy) => {
      copy.connectionId = "different";
    },
    (copy) => {
      copy.ownerId = "different";
    },
    (copy) => {
      copy.running = false;
    },
  ]) {
    const changed = structuredClone(runtime);
    change(changed);
    await assert.rejects(
      pollQueue(api, "one", {
        ...context,
        timeoutMs: 100,
        assertHealthy: async () => {},
        readRuntime: async () => changed,
      }),
      /exact companion execution/,
    );
  }
  let clock = 0;
  await assert.rejects(
    pollQueue(api, "one", {
      ...context,
      timeoutMs: 100,
      assertHealthy: async () => {},
      readRuntime: async () => runtime,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
    }),
    /deadline reached.*do not retry/,
  );
});

test("evidence does not reconstruct worker success from unrelated API IDs", () => {
  const body = { outcome: "recorded", checkpointId: randomUUID(), applicationId: randomUUID() };
  const response = { valid: true, outcome: "recorded", attempt: { ...body } };
  assert.deepEqual(recordedHandback(body, response).handback, body);
  assert.equal(recordedHandback(null, response), null);
  assert.equal(
    recordedHandback(body, { ...response, attempt: { ...body, applicationId: randomUUID() } }),
    null,
  );
  assert.equal(recordedHandback({ ...body, fabricated: true }, response), null);
});

test("PASS requires a final matching usage summary and exactly one total fixture POST after cleanup", () => {
  const raw = approval(),
    grant = exactQueueGrant(validateQueueTestApproval(raw, raw.runId), randomUUID());
  const allocation = grant.allocations[0];
  const executionId = randomUUID();
  const browserSessionId = randomUUID();
  const ownerId = randomUUID();
  const report = {
    work: {
      runtimeSettlement: {
        state: "worker_drained",
        workItemId: allocation.workItemId,
        executionId,
        browserSessionId,
        ownerId,
        lastError: null,
        canonicalObserver: {
          ownerId,
          workItemId: allocation.workItemId,
          executionId,
          currentExecutionId: executionId,
          browserSessionId,
          state: "submitted",
          active: false,
          leaseExpiresAt: null,
        },
      },
    },
    finalFixtureSubmissions: {
      runId: grant.runId,
      submissions: [{ caseId: "greenhouse" }],
      submissionRequests: { greenhouse: 1 },
    },
    usage: {
      summary: {
        event: "stop",
        processOutcome: "completed",
        reason: "completed",
        usageState: "final_provider_metadata",
        runId: grant.runId,
        allocationId: allocation.allocationId,
        workItemId: allocation.workItemId,
        executionId,
        requestedModel: "sonnet",
        provider: "claude",
        actualModels: ["claude-sonnet-5-5", "claude-3-7-sonnet-20250219"],
        durationMs: 2,
        measuredUsage: {
          requests: 1,
          totalTokenOccurrences: 6,
          tokens: { inputTokens: 2, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      },
    },
  };
  assert.equal(
    finalRunChecks(report, grant).every((check) => check.passed),
    true,
  );
  for (const change of [
    (copy) => {
      copy.usage.summary = null;
    },
    (copy) => {
      copy.usage.summary.usageState = "partial_observed";
    },
    (copy) => {
      copy.usage.summary.workItemId = randomUUID();
    },
    (copy) => {
      copy.usage.summary.executionId = randomUUID();
    },
    (copy) => {
      copy.work.runtimeSettlement = null;
    },
    (copy) => {
      copy.work.runtimeSettlement.lastError = "The outcome could not be saved.";
    },
    (copy) => {
      delete copy.work.runtimeSettlement.lastError;
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver = null;
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.currentExecutionId = randomUUID();
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.ownerId = randomUUID();
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.executionId = randomUUID();
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.state = "failed";
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.active = true;
    },
    (copy) => {
      copy.work.runtimeSettlement.canonicalObserver.leaseExpiresAt = new Date().toISOString();
    },
    ...[
      [],
      ["unknown"],
      ["claude-sonnet-5-5", "claude-opus-4-6"],
      ["claude-haiku-4-5"],
      [null],
      ["claude-sonnet-fixture"],
    ].map((models) => (copy) => {
      copy.usage.summary.actualModels = models;
    }),
    (copy) => {
      copy.usage.summary.reason = "process_exception";
      copy.usage.summary.processOutcome = "interrupted";
    },
    (copy) => {
      copy.finalFixtureSubmissions.submissionRequests.lever = 1;
    },
    (copy) => {
      copy.finalFixtureSubmissions.submissionRequests.greenhouse = 2;
    },
  ]) {
    const copy = structuredClone(report);
    change(copy);
    assert.equal(
      finalRunChecks(copy, grant).every((check) => check.passed),
      false,
    );
  }
});

test("private observer captures only the actual authenticated current-lease result-check exchange", async (t) => {
  const workItemId = randomUUID(),
    leaseToken = randomUUID();
  const ownership = { executionId: randomUUID(), browserSessionId: randomUUID() };
  const handback = { outcome: "recorded", checkpointId: randomUUID(), applicationId: randomUUID() };
  const upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url.endsWith("/claim")
          ? { claim: { item: { id: workItemId }, leaseToken, ownership } }
          : { valid: true, outcome: "recorded", attempt: handback },
      ),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const captured = [];
  const proxy = await startEvidenceObserver({
    apiUrl: `http://127.0.0.1:${upstream.address().port}`,
    terminalToken: "synthetic-secret",
    workItemId,
    jobPath: "/api/campaigns/test/jobs/one",
    onHandback: async (value) => captured.push(value),
  });
  t.after(() => proxy.close());
  const headers = { authorization: "Bearer synthetic-secret", "content-type": "application/json" };
  await fetch(`${proxy.url}/api/work-queue/claim`, { method: "POST", headers, body: "{}" });
  assert.deepEqual(proxy.execution(), { workItemId, ...ownership });
  const resultPath = `${proxy.url}/api/campaigns/test/jobs/one/worker-result-check`;
  await fetch(resultPath, { method: "POST", headers, body: JSON.stringify(handback) });
  assert.equal(captured.length, 0);
  await fetch(resultPath, {
    method: "POST",
    headers: {
      ...headers,
      "x-openapply-work-item": workItemId,
      "x-openapply-work-lease": leaseToken,
    },
    body: JSON.stringify(handback),
  });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].handback, handback);
  assert.equal(JSON.stringify(captured).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(captured).includes(leaseToken), false);
  proxy.assertHealthy();
});
