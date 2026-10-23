import assert from "node:assert/strict";
import test from "node:test";
import { scoringUiRequestAllowed } from "./observe-ui.mjs";

const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  pendingRunId: "be26218c-0cd6-48c8-884b-f1761fe87c0a",
  syntheticRunId: "52b71d22-e131-42ea-b752-e2c660cac5d7",
  loginEmail: "synthetic@fixture.test",
  password: "synthetic-only",
};
const check = (method, path, body = null) =>
  scoringUiRequestAllowed(method, `${config.apiUrl}${path}`, body, config);

test("permits paginated reads only for the exact fixture evaluation runs", () => {
  for (const path of [
    "/api/score-evaluations?page=1&limit=10",
    `/api/score-evaluations/${config.pendingRunId}`,
    `/api/score-evaluations/${config.syntheticRunId}/report`,
    `/api/score-evaluations/${config.syntheticRunId}/cases?page=2&limit=1`,
  ])
    assert.equal(check("GET", path), true, path);
  for (const path of [
    "/api/score-evaluations/foreign/report",
    `/api/score-evaluations/${config.pendingRunId}/dispatch`,
    "/api/score-evaluations?run=true",
    "/api/score-evaluations?limit=0",
    "/api/inference",
    "/api/resumes",
    "/api/work-queue/claim",
    "/api/auth/tokens/terminal",
  ])
    assert.equal(check("GET", path), false, path);
});

test("only fixture login and empty auth-session refresh/logout can write", () => {
  assert.equal(check("OPTIONS", "/api/auth/login"), true);
  assert.equal(check("OPTIONS", "/api/auth/tokens/terminal"), false);
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
      "/api/score-evaluations",
      `/api/score-evaluations/${config.pendingRunId}/results`,
      "/api/inference",
      "/api/work-queue/enqueue",
      "/api/applications",
      "/api/auth/tokens/terminal",
    ])
      assert.equal(check(method, path, "{}"), false, `${method} ${path}`);
});

test("blocks companions, external origins and credential-bearing URLs", () => {
  for (const url of [
    "http://127.0.0.1:14102/queue/status",
    "http://127.0.0.1:14102/inference",
    "https://employer.example/jobs",
    "http://secret@127.0.0.1:14101/api/analytics",
    "chrome://resources/js/assert.js",
  ])
    assert.equal(scoringUiRequestAllowed("GET", url, null, config), false, url);
  assert.equal(
    scoringUiRequestAllowed("GET", `${config.webUrl}/analytics/scoring`, null, config),
    true,
  );
  assert.equal(
    scoringUiRequestAllowed("POST", `${config.webUrl}/api/inference`, "{}", config),
    false,
  );
});
