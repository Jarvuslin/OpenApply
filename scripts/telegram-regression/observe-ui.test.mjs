import assert from "node:assert/strict";
import test from "node:test";
import { telegramUiRequestAllowed } from "./observe-ui.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  loginEmail: "fixture@questions.example.test",
  password: "synthetic",
  linkId: id,
  pairingId: id,
  intakeId: id,
  approvalQuestionId: id,
  approvalCheckpointId: id,
  approvalJobId: id,
  approvalCampaignId: id,
  approvalJobKey: "synthetic-job",
  approvalCheckpointHash: "a".repeat(64),
  settingsRevision: 1,
  targetSettings: {
    digestEnabled: true,
    digestHour: 18,
    timeZone: "America/Toronto",
    quietHours: null,
  },
};
const allowed = (method, path, body) =>
  telegramUiRequestAllowed(
    method,
    `${config.apiUrl}${path}`,
    body == null ? null : JSON.stringify(body),
    config,
  );
test("UI allowlist admits only exact synthetic channel edits and approval", () => {
  assert(allowed("GET", `/api/needs-you?kind=operational&target=${id}`));
  assert(allowed("GET", `/api/campaigns/${id}/jobs/synthetic-job/submission-attempt`));
  assert(
    allowed("POST", "/api/auth/login", { email: config.loginEmail, password: config.password }),
  );
  assert(allowed("POST", "/api/telegram/pairing", { requestId: id }));
  assert(allowed("DELETE", `/api/telegram/pairing/${id}`));
  assert(allowed("DELETE", "/api/telegram", { expectedLinkId: id }));
  assert(
    allowed("PATCH", "/api/telegram/settings", {
      ...config.targetSettings,
      requestId: id,
      expectedRevision: 1,
    }),
  );
  const approval = {
    requestId: id,
    checkpointId: id,
    checkpointHash: config.approvalCheckpointHash,
    decision: "approve",
  };
  assert(allowed("POST", `/api/pilot/questions/${id}/decision`, approval));
  for (const change of [
    { decision: "skip" },
    { checkpointHash: "b".repeat(64) },
    { checkpointId: "other" },
    { provider: "claude" },
  ])
    assert.equal(
      allowed("POST", `/api/pilot/questions/${id}/decision`, { ...approval, ...change }),
      false,
    );
});
test("UI guard rejects model, submission, claim, webhooks and unrelated writes", () => {
  for (const path of [
    "/api/telegram/webhook",
    "/api/work-queue/claim",
    "/api/pilot/start",
    `/api/job-intakes/${id}/prepare`,
    `/api/campaigns/${id}/jobs/synthetic-job/submission-begin`,
  ])
    assert.equal(allowed("POST", path, {}), false);
  assert.equal(
    allowed("PATCH", "/api/telegram/settings", {
      ...config.targetSettings,
      digestHour: 20,
      requestId: id,
      expectedRevision: 1,
    }),
    false,
  );
  assert.equal(allowed("GET", "/api/needs-you?target=other"), false);
  assert.equal(allowed("GET", "/api/needs-you?kind=operational&userId=other"), false);
  for (const address of [
    "https://api.telegram.org/bot-fake/sendMessage",
    "https://api.anthropic.com/v1/messages",
    "http://user:secret@127.0.0.1:14101/api/telegram",
  ])
    assert.equal(telegramUiRequestAllowed("GET", address, null, config), false);
  assert.equal(telegramUiRequestAllowed("POST", `${config.webUrl}/api/model`, "{}", config), false);
});
