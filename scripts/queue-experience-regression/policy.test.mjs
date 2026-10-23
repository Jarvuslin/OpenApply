import assert from "node:assert/strict";
import { test } from "node:test";
import { queueExperienceRequestAllowed as allowed } from "./policy.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  companionUrl: "http://127.0.0.1:14102",
  userId: id(1),
  controlId: id(2),
  controlJobId: id(3),
  campaignId: id(4),
  applicationId: id(5),
  itemIds: [id(2), id(7)],
  controlJobKey: "control",
  pdfSha256: "a".repeat(64),
  loginEmail: "test@questions.example.test",
  password: "synthetic-test-only",
  workers: [{ workItemId: id(7), executionId: id(8), browserSessionId: id(9) }],
  frameAllowed: true,
};
const api = (path) => config.apiUrl + path;
const permit = (method, path, body, settings = config) =>
  allowed(method, api(path), body === undefined ? null : JSON.stringify(body), settings);

test("only the exact queue item can receive the three UI controls", () => {
  for (const action of ["pause", "resume", "stop"])
    assert.equal(permit("POST", `/api/work-queue/${config.controlId}/control`, { action }), true);
  for (const body of [{ action: "claim" }, { action: "pause", requestId: id(1) }, null, []])
    assert.equal(permit("POST", `/api/work-queue/${config.controlId}/control`, body), false);
  assert.equal(permit("POST", `/api/work-queue/${id(7)}/control`, { action: "stop" }), false);
});
test("model, grant, preparation and employer actions are denied", () => {
  for (const path of [
    "/api/work-queue/claim",
    "/api/work-queue/schedule",
    "/api/inference",
    "/api/pilot/start",
    "/api/job-intakes",
    `/api/campaigns/${config.campaignId}/jobs/control/submission/begin`,
    "/api/auth/providers",
    "/api/grants",
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "GET"])
      assert.equal(permit(method, path, {}), false, `${method} ${path}`);
  }
  for (const path of [
    "/queue/connect",
    "/inference",
    "/sessions",
    `/queue/workers/${id(9)}/attach`,
    `/queue/workers/${id(9)}/prepare`,
    `/queue/workers/${id(9)}/handoff`,
  ])
    assert.equal(allowed("POST", config.companionUrl + path, "{}", config), false);
});
test("synthetic frame route needs explicit stage and all exact owner identities", () => {
  const address = `${config.companionUrl}/queue/workers/${id(9)}/frame?workItemId=${id(7)}&executionId=${id(8)}`;
  assert.equal(allowed("GET", address, null, config), true);
  assert.equal(allowed("OPTIONS", address, null, config), true);
  assert.equal(allowed("GET", address, null, { ...config, frameAllowed: false }), false);
  for (const bad of [
    address.replace(id(7), id(2)),
    address.replace(id(8), id(10)),
    address.replace(id(9), id(10)),
    `${address}&url=https://example.test`,
    `${address}&workItemId=${id(7)}`,
  ])
    assert.equal(allowed("GET", bad, null, config), false);
  assert.equal(permit("POST", "/api/auth/tokens/terminal"), true);
  assert.equal(
    permit("POST", "/api/auth/tokens/terminal", undefined, { ...config, frameAllowed: false }),
    false,
  );
});
test("submitted PDF is read-only and pinned to the immutable application/hash", () => {
  const path = `/api/applied/${config.applicationId}/submitted-resume?sha256=${config.pdfSha256}`;
  assert.equal(permit("GET", path), true);
  for (const changed of [
    path.replace(config.applicationId, id(10)),
    path.replace(config.pdfSha256, "b".repeat(64)),
    `${path}&download=1`,
  ])
    assert.equal(permit("GET", changed), false);
  assert.equal(permit("POST", path, {}), false);
});

test("country suggestions and Pilot events permit only their query-free read contracts", () => {
  for (const path of ["/api/locations", "/api/pilot/events"]) {
    assert.equal(permit("GET", path), true);
    assert.equal(permit("GET", `${path}?country=CA`), false);
    assert.equal(permit("GET", `${path}?url=https://example.test`), false);
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal(permit(method, path, {}), false);
  }
});
test("network boundary rejects remote origins, credentials, fragments, duplicate pagination and arbitrary queries", () => {
  for (const address of [
    "https://api.telegram.org/bot/sendMessage",
    "https://api.openai.com/v1/responses",
    "http://127.0.0.1:4101/api/auth/me",
    `${config.apiUrl}/api/auth/me#x`,
    "http://secret@127.0.0.1:14101/api/auth/me",
  ])
    assert.equal(allowed("GET", address, null, config), false);
  for (const path of [
    "/api/work-queue?url=https://example.test",
    "/api/work-queue?limit=10000",
    "/api/needs-you?target=other",
    "/api/work-queue?state=unknown",
    "/api/work-queue?page=1&page=2",
  ])
    assert.equal(permit("GET", path), false);
  assert.equal(permit("GET", "/api/work-queue?page=1&limit=25&state=queued"), true);
  assert.equal(permit("GET", "/api/needs-you?page=1&limit=25&kind=all"), true);
  assert.equal(
    permit("POST", "/api/auth/login", { email: config.loginEmail, password: config.password }),
    true,
  );
  assert.equal(
    permit("POST", "/api/auth/login", { email: "other@example.test", password: config.password }),
    false,
  );
});
