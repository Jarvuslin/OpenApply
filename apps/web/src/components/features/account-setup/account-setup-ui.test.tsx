import type { PilotQuestion } from "@openapply/contracts/pilot";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionCard } from "@/components/features/questions/question-card";
import { AccountSetupResponse } from "./account-setup-response";
import { accountSetupPresentation } from "./account-setup-state";
import { AccountSetupSummary } from "./account-setup-summary";
import { accountDetailFixture } from "./fakes";
import { expect, test } from "bun:test";

test("account questions bypass generic answer forms and ignore untrusted prompt and deep link", () => {
  const detail = accountDetailFixture();
  const question: PilotQuestion = {
    id: "21234567-89ab-4cde-8f01-234567890abc",
    userId: "31234567-89ab-4cde-8f01-234567890abc",
    kind: "question",
    status: "open",
    subjectType: "account_setup",
    subjectId: detail.item.id,
    prompt: "Paste a secret here",
    options: [],
    deepLink: "https://attacker.example",
    answer: null,
    answeredAt: null,
    expiresAt: null,
    createdAt: new Date(0),
    approval: null,
  };
  const html = renderToStaticMarkup(<QuestionCard question={question} />);
  expect(html).toContain(`/account-setup/${detail.item.id}`);
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("Send answer");
  expect(html).not.toContain(question.prompt);
  expect(html).not.toContain("attacker.example");
  const invalid = renderToStaticMarkup(
    <QuestionCard question={{ ...question, subjectId: "invalid" }} />,
  );
  expect(invalid).toContain("request is unavailable");
  expect(invalid).not.toContain("<textarea");
});

test("existing login displays only a secure password input and account-specific actions", () => {
  const detail = accountDetailFixture();
  detail.item.state = "needs_user";
  detail.context.attempt.phase = "needs_user";
  detail.context.attempt.reason = "existing_account_credentials";
  const html = renderToStaticMarkup(
    <AccountSetupResponse detail={detail} onUpdated={async () => {}} />,
  );
  expect(html).toContain('type="password"');
  expect(html).toContain("Save password for account inspection");
  expect(html).toContain("Skip account setup");
  expect(html).not.toContain("Skip this application");
  expect(html).not.toContain("Send answer");
  expect(html).not.toContain("Apply now");
});

test("verification continuation preserves the consumed signup and distinguishes mailbox confirmation", () => {
  const detail = accountDetailFixture();
  detail.item.state = "needs_user";
  detail.context.attempt.phase = "verification_pending";
  detail.context.attempt.signupAttempts = 1;
  detail.context.attempt.mailbox = {
    email: detail.context.snapshot.email,
    basis: "user_confirmed",
    confirmedAt: new Date(0),
  };
  const state = accountSetupPresentation(detail);
  expect(state).toMatchObject({
    launch: false,
    password: false,
    continue: true,
    manual: true,
    signupConsumed: true,
  });
  const html = renderToStaticMarkup(<AccountSetupSummary detail={detail} />);
  expect(html).toContain("provider identity has not been verified");
  expect(html).toContain("without repeating signup");
});

test("unknown, authenticated and skipped states cannot launch a new signup", () => {
  const detail = accountDetailFixture();
  detail.item.state = "needs_user";
  detail.context.attempt.phase = "unknown";
  expect(accountSetupPresentation(detail)).toMatchObject({
    launch: false,
    continue: true,
    skip: true,
  });
  for (const phase of ["authenticated", "skipped"] as const) {
    detail.context.attempt.phase = phase;
    expect(accountSetupPresentation(detail)).toMatchObject({
      launch: false,
      continue: false,
      password: false,
      skip: false,
    });
  }
});

test("queued inspection is labeled as inspection and exposes no application controls", () => {
  const detail = accountDetailFixture();
  detail.context.snapshot.operation = "inspect";
  detail.context.attempt.signupAttempts = 1;
  expect(accountSetupPresentation(detail).operationLabel).toBe("Inspect the existing account");
  const html = renderToStaticMarkup(<AccountSetupSummary detail={detail} />);
  expect(html).not.toContain("<button");
  expect(html).not.toContain("Upload resume");
  expect(html).not.toContain("Apply now");
});
