import type { AccountSetupDetail } from "@openapply/contracts/account-setup";

const phaseLabels = {
  checking: "Checking account",
  signup_ready: "Ready for account creation",
  signup_started: "Account creation started",
  verification_pending: "Verification pending",
  needs_user: "Needs you",
  authenticated: "Account session verified",
  unknown: "Account outcome needs inspection",
  skipped: "Account setup skipped",
} as const;

export function accountSetupPresentation(detail: AccountSetupDetail) {
  const {
    item,
    context: { attempt, snapshot },
  } = detail;
  const waiting = item.state === "needs_user";
  const closed =
    ["authenticated", "skipped"].includes(attempt.phase) ||
    ["cancelled", "completed"].includes(item.state);
  const password =
    waiting && attempt.phase === "needs_user" && attempt.reason === "existing_account_credentials";
  return {
    label: phaseLabels[attempt.phase],
    password,
    mailbox:
      waiting &&
      (attempt.reason === "mailbox_identity" || attempt.phase === "verification_pending"),
    manual:
      waiting &&
      (attempt.phase === "verification_pending" ||
        ["password_entry", "terms_confirmation", "verification", "captcha"].includes(
          attempt.reason ?? "",
        )),
    continue: waiting && !closed && !password,
    skip: waiting && !closed,
    launch: item.state === "queued" && !closed,
    signupConsumed: attempt.signupAttempts === 1,
    operationLabel:
      snapshot.operation === "inspect"
        ? "Inspect the existing account"
        : "Set up this employer account",
  };
}
