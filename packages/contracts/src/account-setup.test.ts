import {
  accountSetupContinueSchema,
  accountSetupObserveSchema,
  accountSetupSaveCredentialsSchema,
  enqueueAccountSetupSchema,
} from "./account-setup";
import { describe, expect, it } from "bun:test";

describe("account setup request boundaries", () => {
  const page = {
    browserSessionId: crypto.randomUUID(),
    currentUrl: "https://company.wd1.myworkdayjobs.com/signup",
  };

  it("distinguishes visible signup, absence, existing accounts and actual authentication", () => {
    for (const event of ["signup_form", "no_account", "existing_account"])
      expect(accountSetupObserveSchema.safeParse({ event, ...page }).success).toBe(true);
    expect(accountSetupObserveSchema.safeParse({ event: "authenticated", ...page }).success).toBe(
      false,
    );
    expect(
      accountSetupObserveSchema.safeParse({
        event: "authenticated",
        evidence: "authenticated_session",
        ...page,
      }).success,
    ).toBe(true);
    expect(
      accountSetupObserveSchema.safeParse({ event: "user_confirmed_done", ...page }).success,
    ).toBe(false);
  });

  it("allows only typed request-scoped verification metadata, never codes or messages", () => {
    const request = {
      event: "verification_pending",
      requestedAt: new Date().toISOString(),
      recipient: "applicant@example.com",
      senderDomains: ["myworkday.com"],
      ...page,
    };
    expect(accountSetupObserveSchema.safeParse(request).success).toBe(true);
    for (const field of ["code", "password", "message", "body", "link"])
      expect(
        accountSetupObserveSchema.safeParse({ ...request, [field]: "sensitive" }).success,
      ).toBe(false);
    expect(
      accountSetupObserveSchema.safeParse({
        ...request,
        senderDomains: ["gmail.com newer_than:1d"],
      }).success,
    ).toBe(false);
  });

  it("keeps passwords exclusive to the secure credential mutation and binds every human action to a revision", () => {
    const create = {
      idempotencyKey: crypto.randomUUID(),
      credentialId: crypto.randomUUID(),
      signupUrl: page.currentUrl,
      tenantOrigin: new URL(page.currentUrl).origin,
      email: "applicant@example.com",
      mailboxConfirmation: { email: "applicant@example.com", basis: "user_confirmed" },
    };
    expect(enqueueAccountSetupSchema.safeParse(create).success).toBe(true);
    expect(enqueueAccountSetupSchema.safeParse({ ...create, password: "secret" }).success).toBe(
      false,
    );
    expect(accountSetupContinueSchema.safeParse({ action: "continue" }).success).toBe(false);
    expect(
      accountSetupContinueSchema.safeParse({
        expectedRevision: 1,
        action: "continue",
        authenticated: true,
      }).success,
    ).toBe(false);
    expect(
      accountSetupSaveCredentialsSchema.safeParse({ expectedRevision: 1, password: "secret" })
        .success,
    ).toBe(true);
    expect(
      accountSetupSaveCredentialsSchema.safeParse({
        expectedRevision: 1,
        password: "secret",
        email: "other@example.com",
      }).success,
    ).toBe(false);
  });
});
