import assert from "node:assert/strict";
import test from "node:test";
import { fixture, runHelper } from "./api-test-helpers.mjs";

const context = {
  OPENAPPLY_WORK_ITEM_ID: "0f10c434-0b9a-4980-91ca-5a71bb80751a",
  OPENAPPLY_WORK_LEASE_TOKEN: "b21a6159-9d2a-42a3-a021-a46851fa063f",
};

test("queue API calls carry the paired lease without exposing it in output", async (t) => {
  const { requests, base } = await fixture(t);
  const result = await runHelper(base, ["GET", "/api/health"], context);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].headers["x-openapply-work-item"], context.OPENAPPLY_WORK_ITEM_ID);
  assert.equal(requests[0].headers["x-openapply-work-lease"], context.OPENAPPLY_WORK_LEASE_TOKEN);
  assert.doesNotMatch(result.stdout + result.stderr, /b21a6159|test-token/);
});

test("invalid or partial queue context fails before any request", async (t) => {
  const { requests, base } = await fixture(t);
  for (const env of [
    { OPENAPPLY_WORK_ITEM_ID: context.OPENAPPLY_WORK_ITEM_ID },
    { OPENAPPLY_WORK_LEASE_TOKEN: context.OPENAPPLY_WORK_LEASE_TOKEN },
    { ...context, OPENAPPLY_WORK_ITEM_ID: "invalid" },
    { ...context, OPENAPPLY_WORK_LEASE_TOKEN: "bad\nsecret" },
  ]) {
    const result = await runHelper(base, ["GET", "/api/health"], env);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /valid paired work item and lease/);
    assert.doesNotMatch(result.stderr, /secret|b21a6159/);
  }
  assert.equal(requests.length, 0);
});

test("redirects cannot forward queue credentials to a different origin", async (t) => {
  const source = await fixture(t);
  const destination = await fixture(t);
  source.reply.status = 307;
  source.reply.headers.location = `${destination.base}/api/health`;
  const result = await runHelper(source.base, ["GET", "/api/health"], context);
  assert.equal(result.code, 1);
  assert.equal(source.requests.length, 1);
  assert.equal(destination.requests.length, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /b21a6159|test-token/);
});

test("API error and success echoes redact lease and bearer credentials", async (t) => {
  const { reply, base } = await fixture(t);
  reply.body = JSON.stringify({ error: `${context.OPENAPPLY_WORK_LEASE_TOKEN} test-token` });
  for (const status of [200, 409]) {
    reply.status = status;
    const result = await runHelper(base, ["GET", "/api/health"], context);
    assert.equal(result.code, status === 200 ? 0 : 1);
    assert.match(result.stdout + result.stderr, /\[redacted\]/);
    assert.doesNotMatch(result.stdout + result.stderr, /b21a6159|test-token/);
  }
});
