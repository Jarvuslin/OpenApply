import assert from "node:assert/strict";
import test from "node:test";
import { concurrencyUiRequestAllowed } from "./observe-ui.mjs";

const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  loginEmail: "synthetic@fixture.test",
  password: "synthetic-only",
  expectedRevision: 1,
  targetLimits: {
    maxConcurrentWorkers: 2,
    dailyApplicationCap: 11,
    companyApplicationCap: 4,
    companyWindowDays: 7,
    domainDelaySeconds: 45,
  },
};
const input = {
  ...config.targetLimits,
  expectedRevision: 1,
  requestId: "51a67b49-f32f-4158-b536-2d98108e1605",
};
const check = (method, path, body = null, options = config) =>
  concurrencyUiRequestAllowed(method, `${config.apiUrl}${path}`, body, options);

test("only the exact fixture policy and reviewed revision can be saved", () => {
  assert.equal(check("PUT", "/api/work-queue/limits", JSON.stringify(input)), true);
  assert.equal(check("OPTIONS", "/api/work-queue/limits"), true);
  for (const patch of [
    { expectedRevision: 2 },
    { maxConcurrentWorkers: 3 },
    { dailyApplicationCap: 500 },
    { requestId: "invalid" },
    { autoStart: true },
  ])
    assert.equal(
      check("PUT", "/api/work-queue/limits", JSON.stringify({ ...input, ...patch })),
      false,
    );
  assert.equal(
    check("PUT", "/api/work-queue/limits", JSON.stringify(input), {
      ...config,
      expectedRevision: undefined,
    }),
    false,
  );
  assert.equal(check("PUT", "/api/work-queue/limits?claim=true", JSON.stringify(input)), false);
});

test("read scope covers paginated queue and whole-queue estimate without dispatch endpoints", () => {
  for (const path of [
    "/api/work-queue?state=queued&page=2&limit=1",
    "/api/work-queue?state=paused",
    "/api/work-queue/limits",
    "/api/work-queue/estimate",
    "/api/work-queue/events",
    "/api/work-queue/summary",
  ])
    assert.equal(check("GET", path), true, path);
  for (const path of [
    "/api/work-queue?run=true",
    "/api/work-queue?limit=0",
    "/api/work-queue/estimate?campaignId=foreign",
    "/api/work-queue/claim",
    "/api/work-queue/schedule",
    "/api/auth/tokens/terminal",
    "/api/inference",
    "/api/resumes",
  ])
    assert.equal(check("GET", path), false, path);
});

test("auth writes are limited to exact fixture login and empty session refresh", () => {
  assert.equal(
    check(
      "POST",
      "/api/auth/login",
      JSON.stringify({ email: config.loginEmail, password: config.password }),
    ),
    true,
  );
  assert.equal(check("POST", "/api/auth/refresh"), true);
  assert.equal(
    check(
      "POST",
      "/api/auth/login",
      JSON.stringify({ email: "other@fixture.test", password: config.password }),
    ),
    false,
  );
  assert.equal(check("POST", "/api/auth/refresh", "{}"), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    for (const path of [
      "/api/work-queue/claim",
      "/api/work-queue/enqueue",
      "/api/work-queue/fixture/control",
      "/api/applications",
      "/api/inference",
      "/api/auth/tokens/terminal",
    ])
      assert.equal(check(method, path, JSON.stringify(input)), false, `${method} ${path}`);
});

test("companion and external access is blocked regardless of matching paths", () => {
  for (const address of [
    "http://127.0.0.1:14102/queue/status",
    "http://127.0.0.1:14102/queue/connect",
    "https://employer.example/form",
    "http://secret@127.0.0.1:14101/api/work-queue/limits",
    "chrome://resources/js/assert.js",
  ])
    for (const method of ["GET", "PUT", "POST"])
      assert.equal(
        concurrencyUiRequestAllowed(method, address, JSON.stringify(input), config),
        false,
      );
  assert.equal(concurrencyUiRequestAllowed("GET", `${config.webUrl}/queue`, null, config), true);
  assert.equal(
    concurrencyUiRequestAllowed("POST", `${config.webUrl}/api/inference`, "{}", config),
    false,
  );
});
