import assert from "node:assert/strict";
import test from "node:test";
import {
  preparationUiFailure,
  preparationUiFixtureQuestion,
  preparationUiRequestAllowed,
} from "./observe-ui.mjs";

const id = "e9a45748-e121-4424-b6f0-c56d1f017c6a";
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  companionUrl: "http://127.0.0.1:14102",
  questionId: id,
  jobId: "a83df719-bb9d-47e5-a680-068efef189f1",
  resumeId: "154f7335-c4a1-4dcf-a202-b610123cd352",
  collectionVersion: 2,
  questionRevision: 1,
  definitionHash: "a".repeat(64),
  artifactRevision: "b".repeat(64),
  fileFieldKey: "resume",
  manifestHash: "c".repeat(64),
  allowPreparation: false,
};
const input = {
  requestId: id,
  jobId: config.jobId,
  expectedCollectionVersion: 2,
  expectedRevision: 1,
  expectedDefinitionHash: config.definitionHash,
  fieldKey: "resume",
  resumeId: config.resumeId,
  artifactRevision: config.artifactRevision,
  expectedSelectionId: null,
  confirmed: true,
};
const selectUrl = `${config.apiUrl}/api/application-questions/${id}/document-selection`;
const check = (url, body, patch = {}, method = "POST") =>
  preparationUiRequestAllowed(method, url, typeof body === "string" ? body : JSON.stringify(body), {
    ...config,
    ...patch,
  });

test("allows only the exact explicitly confirmed current synthetic PDF selection", () => {
  assert.equal(check(selectUrl, input), true);
  for (const patch of [
    { confirmed: false },
    { jobId: id },
    { resumeId: id },
    { artifactRevision: "d".repeat(64) },
    { expectedRevision: 2 },
    { expectedSelectionId: id },
    { expectedCollectionVersion: 3 },
    { fieldKey: "cover_letter" },
    { filename: "resume.pdf" },
    { variantId: id },
  ])
    assert.equal(check(selectUrl, { ...input, ...patch }), false);
  assert.equal(check(selectUrl.replace(id, config.resumeId), input), false);
});
test("preparation token and host request require the explicit preparation stage and exact manifest", () => {
  const url = `${config.companionUrl}/preparation/fill`;
  const payload = {
    apiToken: "synthetic-token",
    apiUrl: config.apiUrl,
    jobId: config.jobId,
    requestId: id,
    expectedCollectionVersion: 2,
    manifestHash: config.manifestHash,
  };
  assert.equal(check(url, payload), false);
  assert.equal(check(url, payload, { allowPreparation: true }), true);
  assert.equal(check(url, null, { allowPreparation: true }, "OPTIONS"), true);
  assert.equal(
    check(`${config.companionUrl}/inference`, null, { allowPreparation: true }, "OPTIONS"),
    false,
  );
  for (const patch of [
    { apiUrl: "https://external.test" },
    { jobId: id },
    { manifestHash: "d".repeat(64) },
    { expectedCollectionVersion: 4 },
    { model: "anything" },
    { apiToken: "" },
  ])
    assert.equal(check(url, { ...payload, ...patch }, { allowPreparation: true }), false);
  const token = `${config.apiUrl}/api/auth/tokens/terminal`;
  assert.equal(check(token, null), false);
  assert.equal(check(token, null, { allowPreparation: true }), true);
  assert.equal(check(token, { unexpected: true }, { allowPreparation: true }), false);
});
test("blocks model, live submission, factual filename answers and arbitrary backend mutations", () => {
  for (const path of [
    "/api/auth/tokens/other",
    "/api/applications",
    "/api/work-queue/enqueue",
    `/api/application-questions/${id}/answers`,
    `/api/campaigns/${id}/jobs/job/submission-begin`,
    `/api/jobs/${id}/preparation-results`,
  ])
    assert.equal(check(`${config.apiUrl}${path}`, {}, { allowPreparation: true }), false);
  for (const path of ["/inference", "/queue/connect", "/questions/collect"])
    assert.equal(check(`${config.companionUrl}${path}`, {}, { allowPreparation: true }), false);
  assert.equal(check("http://127.0.0.1:14640/form", {}, { allowPreparation: true }), false);
  assert.equal(check("https://employer.example/form", null, {}, "GET"), false);
  assert.equal(
    check(`${config.apiUrl}/api/jobs/${id}/preparation?mode=preview`, null, {}, "GET"),
    true,
  );
});

test("canonical file fixture retains strict current ownership, blocker and unanswered checks", () => {
  const question = {
    id,
    jobId: config.jobId,
    current: true,
    blocking: true,
    answer: null,
    definition: { fields: [{ key: "resume", type: "file" }] },
  };
  const canonical = {
    job: { id: config.jobId },
    collectionVersion: 2,
    questions: [question],
  };
  assert.equal(preparationUiFixtureQuestion(canonical, config), question);
  for (const [patch, code] of [
    [{ current: false }, "fixture-question-stale"],
    [{ jobId: id }, "fixture-question-stale"],
    [{ blocking: false }, "fixture-question-not-blocking"],
    [{ answer: { values: [{ value: "resume.pdf" }] } }, "fixture-answer-present"],
    [{ definition: { fields: [{ key: "resume", type: "text" }] } }, "fixture-upload-missing"],
  ])
    assert.throws(
      () =>
        preparationUiFixtureQuestion(
          { ...canonical, questions: [{ ...question, ...patch }] },
          config,
        ),
      (error) => preparationUiFailure(error).code === code,
    );
  assert.throws(
    () => preparationUiFixtureQuestion({ ...canonical, questions: [] }, config),
    (error) => preparationUiFailure(error).code === "fixture-question-missing",
  );
  assert.throws(
    () => preparationUiFixtureQuestion({ ...canonical, job: { id } }, config),
    (error) => preparationUiFailure(error).code === "fixture-collection-invalid",
  );
});

test("failure diagnostics distinguish locator ambiguity without copying DOM or secrets", () => {
  const sensitive = "apiToken=secret-synthetic-token password=synthetic-password";
  assert.deepEqual(preparationUiFailure(new Error(`strict mode violation: ${sensitive}`)), {
    code: "locator-ambiguous",
    message: "The UI locator matched multiple elements.",
  });
  assert.deepEqual(
    preparationUiFailure(Object.assign(new Error(sensitive), { name: "TimeoutError" })),
    {
      code: "ui-timeout",
      message: "The expected UI state did not appear before the deadline.",
    },
  );
  for (const error of [new Error(sensitive), { message: sensitive }, sensitive, null]) {
    const result = preparationUiFailure(error);
    assert.equal(result.code, "unexpected-error");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(JSON.stringify(result).includes("password"), false);
  }
});
