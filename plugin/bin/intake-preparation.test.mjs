import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { intakePreparation } from "./intake-preparation.mjs";

function fixture() {
  const workItemId = randomUUID(),
    lease = randomUUID(),
    snapshotHash = "a".repeat(64);
  return {
    OPENAPPLY_API: "https://api.example.test",
    OPENAPPLY_WORK_ITEM_ID: workItemId,
    OPENAPPLY_WORK_LEASE_TOKEN: lease,
    OPENAPPLY_API_TOKEN: `prep.${workItemId}.${lease}`,
    OPENAPPLY_PREPARATION_SNAPSHOT: snapshotHash,
  };
}

test("fixed preparation only uses capability routes and one read-only inspection, without retry", async () => {
  const env = fixture();
  const calls = [];
  let inspections = 0;
  const context = {
    snapshot: {
      workItemId: env.OPENAPPLY_WORK_ITEM_ID,
      snapshotHash: env.OPENAPPLY_PREPARATION_SNAPSHOT,
      purpose: "intake_prepare",
    },
    questions: { collectionVersion: 7 },
    fit: null,
  };
  const result = await intakePreparation(
    "collect",
    undefined,
    env,
    async (url, options) => {
      calls.push([url, options]);
      assert.equal(options.headers.Authorization, `Bearer ${env.OPENAPPLY_API_TOKEN}`);
      assert.equal(options.redirect, "error");
      assert.ok(!url.includes(env.OPENAPPLY_API_TOKEN));
      return Response.json(url.endsWith("/context") ? context : { ok: true });
    },
    async (action) => {
      inspections++;
      assert.equal(action, "inspect");
      return {
        description: "Synthetic posting ".repeat(20),
        sourceUrl: "https://jobs.lever.co/synthetic/job/apply",
        coverage: "partial",
        reason: "Conditional branches unknown.",
        definitions: [],
        submissionAllowed: false,
      };
    },
  );
  assert.equal(inspections, 1);
  assert.equal(result.postingSaved, true);
  assert.equal(result.submissionAllowed, false);
  assert.deepEqual(
    calls.map(([url]) => new URL(url).pathname),
    [
      "/api/intake-preparation/context",
      "/api/intake-preparation/posting",
      "/api/intake-preparation/questions",
      "/api/intake-preparation/context",
    ],
  );
  assert.equal(JSON.parse(calls[2][1].body).expectedCollectionVersion, 7);
  let failed = 0;
  await assert.rejects(
    intakePreparation("context", undefined, env, async () => {
      failed++;
      return new Response("", { status: 409 });
    }),
  );
  assert.equal(failed, 1);
});

test("general account tokens, changed snapshots and oversized responses fail closed", async () => {
  const env = fixture();
  let calls = 0;
  await assert.rejects(
    intakePreparation(
      "context",
      undefined,
      { ...env, OPENAPPLY_API_TOKEN: "account-pat" },
      async () => {
        calls++;
      },
    ),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    intakePreparation("context", undefined, env, async () =>
      Response.json({
        snapshot: { workItemId: randomUUID(), snapshotHash: env.OPENAPPLY_PREPARATION_SNAPSHOT },
      }),
    ),
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1000001));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    intakePreparation("context", undefined, env, async () => new Response(stream)),
  );
  assert.equal(cancelled, true);
});

test("short or truncated posting is never represented as a saved full posting", async () => {
  const env = fixture();
  const calls = [];
  const context = {
    snapshot: {
      workItemId: env.OPENAPPLY_WORK_ITEM_ID,
      snapshotHash: env.OPENAPPLY_PREPARATION_SNAPSHOT,
      purpose: "intake_prepare",
    },
    questions: { collectionVersion: 0 },
  };
  const result = await intakePreparation(
    "collect",
    undefined,
    env,
    async (url, options) => {
      calls.push([url, options]);
      return Response.json(url.endsWith("/context") ? context : {});
    },
    async () => ({
      description: null,
      truncated: true,
      sourceUrl: "https://jobs.lever.co/synthetic/job/apply",
      coverage: "blocked",
      reason: null,
      definitions: [],
      submissionAllowed: false,
    }),
  );
  assert.equal(result.postingSaved, false);
  assert.equal(
    calls.some(([url]) => url.endsWith("/posting")),
    false,
  );
  assert.equal("reason" in JSON.parse(calls[1][1].body), false);
});
