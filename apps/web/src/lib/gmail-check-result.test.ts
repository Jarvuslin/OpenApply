import { parseGmailCheckResult } from "./gmail-check-result";
import { expect, test } from "bun:test";

const connected = {
  provider: "claude",
  status: "connected",
  mailbox: "Applicant@Example.com",
  message: "Identity and search verified.",
  action: null,
};

test("accepts only the requested mailbox and normalizes case", () => {
  expect(parseGmailCheckResult(connected, "claude", " applicant@example.com ").mailbox).toBe(
    "applicant@example.com",
  );
});

test("a different mailbox requires the user to switch accounts", () => {
  expect(parseGmailCheckResult(connected, "claude", "other@example.com")).toMatchObject({
    status: "needs_user",
    action: "switch_account",
  });
});

test("rejects a response from a different provider or an unverified address", () => {
  expect(() => parseGmailCheckResult(connected, "codex", "applicant@example.com")).toThrow();
  expect(() =>
    parseGmailCheckResult({ ...connected, mailbox: null }, "claude", "applicant@example.com"),
  ).toThrow();
});

test("missing authorization never becomes a saved connection", () => {
  expect(
    parseGmailCheckResult(
      { ...connected, status: "needs_user", mailbox: null, action: "connect_gmail" },
      "claude",
      "applicant@example.com",
    ).status,
  ).toBe("needs_user");
});

test("read access without mailbox identity requires address confirmation", () => {
  const result = parseGmailCheckResult(
    { ...connected, status: "read_access", mailbox: null, action: "confirm_mailbox" },
    "claude",
    "applicant@example.com",
  );
  expect(result.status).toBe("read_access");
  expect(result.mailbox).toBeNull();
  expect(result.action).toBe("confirm_mailbox");
});

test("read-only access cannot smuggle a claimed mailbox or skip confirmation", () => {
  for (const fields of [
    { mailbox: "claimed@example.com", action: "confirm_mailbox" },
    { mailbox: null, action: null },
  ]) {
    expect(() =>
      parseGmailCheckResult(
        { ...connected, status: "read_access", ...fields },
        "claude",
        "applicant@example.com",
      ),
    ).toThrow();
  }
});
