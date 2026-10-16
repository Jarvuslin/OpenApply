import assert from "node:assert/strict";
import test from "node:test";
import { queueUiRequestAllowed } from "./observe-ui.mjs";

const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  workItemId: "d9051818-4d3b-4186-a171-6b04af1454a9",
};
const control = `${config.apiUrl}/api/work-queue/${config.workItemId}/control`;

test("only the explicitly seeded item's three controls and normal auth can mutate", () => {
  for (const action of ["pause", "resume", "stop"])
    assert.equal(queueUiRequestAllowed("POST", control, JSON.stringify({ action }), config), true);
  assert.equal(
    queueUiRequestAllowed("POST", `${config.apiUrl}/api/auth/login`, "{}", config),
    true,
  );
  assert.equal(
    queueUiRequestAllowed("POST", control, '{"action":"resume","jobIds":["other"]}', config),
    false,
  );
  assert.equal(
    queueUiRequestAllowed(
      "POST",
      control.replace(config.workItemId, "other-item"),
      '{"action":"stop"}',
      config,
    ),
    false,
  );
  assert.equal(queueUiRequestAllowed("PATCH", control, "{}", config), false);
  assert.equal(queueUiRequestAllowed("POST", control, "malformed", config), false);
});

test("all model, companion, external and application mutation routes are blocked", () => {
  for (const [method, address] of [
    ["POST", `${config.apiUrl}/api/work-queue/enqueue`],
    ["POST", `${config.apiUrl}/api/work-queue/claim`],
    ["GET", `${config.apiUrl}/api/work-queue/claim`],
    ["POST", `${config.apiUrl}/api/work-queue/schedule`],
    ["POST", `${config.apiUrl}/api/mvp/apply`],
    ["GET", `${config.apiUrl}/inference`],
    ["POST", "http://127.0.0.1:14102/queue/connect"],
    ["GET", "http://127.0.0.1:14102/queue/status"],
    ["GET", "https://employer.example/apply"],
    ["GET", "http://secret@127.0.0.1:14100/queue"],
  ])
    assert.equal(
      queueUiRequestAllowed(method, address, "{}", config),
      false,
      `${method} ${address}`,
    );
});

test("authenticated queue reads and app assets remain available", () => {
  assert.equal(
    queueUiRequestAllowed("GET", `${config.apiUrl}/api/work-queue?page=1&limit=25`, null, config),
    true,
  );
  assert.equal(
    queueUiRequestAllowed("GET", `${config.apiUrl}/api/work-queue/events`, null, config),
    true,
  );
  assert.equal(
    queueUiRequestAllowed("GET", `${config.webUrl}/_next/static/chunks/app.js`, null, config),
    true,
  );
});
