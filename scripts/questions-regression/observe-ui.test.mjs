import assert from "node:assert/strict";
import test from "node:test";
import { questionsUiDiagnosticAllowed, questionsUiRequestAllowed } from "./observe-ui.mjs";

const id = "e9a45748-e121-4424-b6f0-c56d1f017c6a";
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  questions: [{ id, fieldKey: "authorization" }],
  operationalQuestionId: "a83df719-bb9d-47e5-a680-068efef189f1",
};
const answerUrl = `${config.apiUrl}/api/application-questions/${id}/answers`;
const payload = {
  requestId: id,
  expectedRevision: 1,
  expectedDefinitionHash: "a".repeat(64),
  confirmed: true,
  values: [{ fieldKey: "authorization", value: "no" }],
};

test("Next stack-frame diagnostics are separate, narrowly scoped read-only development requests", () => {
  assert.equal(
    questionsUiRequestAllowed(
      "GET",
      `${config.webUrl}/__nextjs_font/geist-latin.woff2`,
      null,
      config,
    ),
    true,
  );
  assert.equal(
    questionsUiRequestAllowed(
      "POST",
      `${config.webUrl}/__nextjs_font/geist-latin.woff2`,
      "{}",
      config,
    ),
    false,
  );
  assert.equal(
    questionsUiRequestAllowed("GET", `${config.webUrl}/__nextjs_font/other`, null, config),
    false,
  );
  const body = JSON.stringify({
    frames: [],
    isServer: false,
    isEdgeServer: false,
    isAppDirectory: true,
  });
  const address = `${config.webUrl}/__nextjs_original-stack-frames`;
  assert.equal(questionsUiDiagnosticAllowed("POST", address, body, config), true);
  assert.equal(questionsUiRequestAllowed("POST", address, body, config), false);
  assert.equal(questionsUiDiagnosticAllowed("POST", `${address}?file=secret`, body, config), false);
  assert.equal(
    questionsUiDiagnosticAllowed(
      "POST",
      address.replace(config.webUrl, config.apiUrl),
      body,
      config,
    ),
    false,
  );
  assert.equal(
    questionsUiDiagnosticAllowed(
      "POST",
      address.replace("original-stack-frames", "launch-editor"),
      body,
      config,
    ),
    false,
  );
  assert.equal(
    questionsUiDiagnosticAllowed("POST", address, '{"frames":[],"other":true}', config),
    false,
  );
  assert.equal(
    questionsUiRequestAllowed(
      "GET",
      `${config.webUrl}/__nextjs_launch-editor?file=anything`,
      null,
      config,
    ),
    false,
  );
});

test("permits only explicitly confirmed exact synthetic question scope", () => {
  assert.equal(questionsUiRequestAllowed("POST", answerUrl, JSON.stringify(payload), config), true);
  for (const patch of [
    { confirmed: false },
    { expectedRevision: 0 },
    { requestId: "invalid" },
    { values: [{ fieldKey: "other", value: "yes" }] },
    { extra: true },
  ])
    assert.equal(
      questionsUiRequestAllowed(
        "POST",
        answerUrl,
        JSON.stringify({ ...payload, ...patch }),
        config,
      ),
      false,
    );
  assert.equal(
    questionsUiRequestAllowed(
      "POST",
      answerUrl.replace(id, "other"),
      JSON.stringify(payload),
      config,
    ),
    false,
  );
  assert.equal(
    questionsUiRequestAllowed(
      "POST",
      `${config.apiUrl}/api/pilot/questions/${config.operationalQuestionId}/answer`,
      '{"answer":"Approve"}',
      config,
    ),
    true,
  );
  assert.equal(
    questionsUiRequestAllowed(
      "POST",
      `${config.apiUrl}/api/pilot/questions/${config.operationalQuestionId}/answer`,
      '{"answer":"something else"}',
      config,
    ),
    false,
  );
});

test("blocks model, companion, collection, submission and arbitrary mutation routes", () => {
  for (const [method, path] of [
    ["GET", "/inference"],
    ["GET", "/api/providers/status"],
    ["POST", "/api/work-queue/enqueue"],
    ["GET", "/api/work-queue/claim"],
    ["POST", `/api/jobs/${id}/questions/collect-public`],
    ["POST", "/api/auth/tokens/terminal"],
    ["POST", "/api/applications"],
    ["GET", "/api/submit"],
  ])
    assert.equal(questionsUiRequestAllowed(method, `${config.apiUrl}${path}`, "{}", config), false);
  assert.equal(
    questionsUiRequestAllowed("GET", "https://employer.example/form", null, config),
    false,
  );
  assert.equal(
    questionsUiRequestAllowed("POST", "http://127.0.0.1:14102/questions/collect", "{}", config),
    false,
  );
  assert.equal(
    questionsUiRequestAllowed("GET", "http://secret@127.0.0.1:14100/needs-you", null, config),
    false,
  );
});

test("permits local read-only question/queue evidence and normal authentication", () => {
  for (const path of [
    "/api/needs-you?limit=25",
    "/api/needs-you/count",
    "/api/needs-you/events",
    `/api/jobs/${id}/questions`,
    `/api/work-queue/${id}`,
  ])
    assert.equal(questionsUiRequestAllowed("GET", `${config.apiUrl}${path}`, null, config), true);
  assert.equal(
    questionsUiRequestAllowed("GET", `${config.webUrl}/_next/static/app.js`, null, config),
    true,
  );
  assert.equal(
    questionsUiRequestAllowed("POST", `${config.apiUrl}/api/auth/login`, "{}", config),
    true,
  );
});
