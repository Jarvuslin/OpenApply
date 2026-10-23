import assert from "node:assert/strict";
import test from "node:test";
import { answerBankUiRequestAllowed } from "./observe-ui.mjs";

const id = "e9a45748-e121-4424-b6f0-c56d1f017c6a";
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  questionId: id,
  entryId: "a83df719-bb9d-47e5-a680-068efef189f1",
  entryRevision: 2,
  fieldKey: "target-work-right",
  mappedValue: "allowed",
  countryCode: "CA",
  saveQuestionId: "154f7335-c4a1-4dcf-a202-b610123cd352",
  saveFieldKey: "contact_email",
  saveValue: "bank.fixture@questions.example.test",
};
const payload = {
  requestId: id,
  expectedRevision: 1,
  expectedDefinitionHash: "a".repeat(64),
  confirmed: true,
  values: [{ fieldKey: config.fieldKey, value: config.mappedValue }],
  useSavedAnswer: {
    entryId: config.entryId,
    revision: config.entryRevision,
    countryCode: "CA",
    countryConfirmed: true,
  },
};
const path = `${config.apiUrl}/api/application-questions/${id}/answers`;
const allowed = (address, value, method = "POST") =>
  answerBankUiRequestAllowed(method, address, JSON.stringify(value), config);

test("reuse mutation is exact synthetic question, mapped value, saved revision and confirmed country", () => {
  assert.equal(allowed(path, payload), true);
  for (const patch of [
    { confirmed: false },
    { expectedRevision: 0 },
    { values: [{ fieldKey: config.fieldKey, value: "no" }] },
    { saveToProfile: { consent: true, scope: "account" } },
    { useSavedAnswer: { ...payload.useSavedAnswer, revision: 1 } },
    { useSavedAnswer: { ...payload.useSavedAnswer, countryConfirmed: false } },
    { useSavedAnswer: { ...payload.useSavedAnswer, entryId: id } },
  ])
    assert.equal(allowed(path, { ...payload, ...patch }), false);
  assert.equal(allowed(path.replace(id, config.saveQuestionId), payload), false);
  assert.equal(allowed(`${path}?unexpected=true`, payload), false);
  for (const patch of [{ values: [null] }, { useSavedAnswer: null }, { values: [false] }])
    assert.equal(allowed(path, { ...payload, ...patch }), false);
});
test("only explicit fixture country match request and seeded entry revocation are allowed", () => {
  const match = `${config.apiUrl}/api/application-questions/${id}/answer-matches`;
  const input = {
    expectedRevision: 1,
    expectedDefinitionHash: "a".repeat(64),
    countryCode: "CA",
    countryConfirmed: true,
  };
  assert.equal(allowed(match, input), true);
  assert.equal(allowed(match, { ...input, countryCode: "US" }), false);
  assert.equal(allowed(match, { ...input, countryConfirmed: false }), false);
  const revoke = `${config.apiUrl}/api/answer-bank/${config.entryId}/revoke`;
  assert.equal(allowed(revoke, { requestId: id, expectedRevision: 2 }), true);
  assert.equal(allowed(revoke, { requestId: id, expectedRevision: 3 }), false);
  assert.equal(
    allowed(revoke.replace(config.entryId, id), { requestId: id, expectedRevision: 2 }),
    false,
  );
});
test("atomic contact save permits exactly employer consent and its synthetic value", () => {
  const { useSavedAnswer: _use, ...answer } = payload;
  const input = {
    ...answer,
    values: [{ fieldKey: config.saveFieldKey, value: config.saveValue }],
    saveToProfile: { consent: true, scope: "employer" },
  };
  const address = `${config.apiUrl}/api/application-questions/${config.saveQuestionId}/answers`;
  assert.equal(allowed(address, input), true);
  assert.equal(
    allowed(address, { ...input, saveToProfile: { consent: false, scope: "employer" } }),
    false,
  );
  assert.equal(
    allowed(address, { ...input, saveToProfile: { consent: true, scope: "account" } }),
    false,
  );
});
test("model, companion, submission, arbitrary bank corrections and external traffic are blocked", () => {
  for (const endpoint of [
    "/api/providers/status",
    "/api/work-queue/claim",
    "/api/submit",
    "/inference",
  ])
    assert.equal(allowed(`${config.apiUrl}${endpoint}`, null, "GET"), false);
  for (const endpoint of [
    "/api/auth/tokens/terminal",
    "/api/work-queue/enqueue",
    "/api/applications",
    `/api/answer-bank/${config.entryId}/revisions`,
  ])
    assert.equal(allowed(`${config.apiUrl}${endpoint}`, {}), false);
  assert.equal(allowed("https://employer.example/form", null, "GET"), false);
  assert.equal(allowed("http://127.0.0.1:14102/questions/collect", {}), false);
  assert.equal(allowed(`${config.apiUrl}/api/answer-bank?page=1&limit=25`, null, "GET"), true);
  assert.equal(
    allowed(`${config.webUrl}/__nextjs_launch-editor?file=anything`, null, "GET"),
    false,
  );
});
