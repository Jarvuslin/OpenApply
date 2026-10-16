import { storedAccountSetup } from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("account setup scoped verification", () => {
  it("accepts explicit human mailbox provenance only for the exact signup recipient", async () => {
    const f = accountFixture();
    f.input.mailboxConfirmation = { email: f.input.email, basis: "user_confirmed" };
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await f.service.observe(authorization, { event: "signup_form", ...page });
    const begun = await f.service.begin(authorization);
    const request = {
      event: "verification_pending" as const,
      requestedAt: new Date().toISOString(),
      recipient: f.input.email,
      senderDomains: ["myworkday.com"],
      ...page,
    };
    await expect(
      f.service.observe(authorization, { ...request, recipient: "other@example.com" }),
    ).rejects.toThrow("recipient");
    await expect(
      f.service.observe(authorization, {
        ...request,
        requestedAt: new Date(begun.attempt.begunAt!.getTime() - 1000).toISOString(),
      }),
    ).rejects.toThrow("request time");
    const pending = await f.service.observe(authorization, request);
    expect(pending.attempt).toMatchObject({
      phase: "verification_pending",
      mailbox: { email: f.input.email, basis: "user_confirmed" },
      verification: { recipient: f.input.email, tenantOrigin: f.input.tenantOrigin },
    });
    expect(pending.attempt.verification!.requestedAt.toISOString()).toBe(request.requestedAt);
    const done = await f.service.observe(authorization, {
      event: "authenticated",
      evidence: "authenticated_session",
      ...page,
    });
    expect(done.attempt.phase).toBe("authenticated");
    expect(f.questions[0].status).toBe("cancelled");
  });

  it("requires mailbox identity before verification and never overrides a known mismatch with a user checkbox", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await f.service.observe(authorization, { event: "signup_form", ...page });
    await f.service.begin(authorization);
    const pending = await f.service.observe(authorization, {
      event: "verification_pending",
      requestedAt: new Date().toISOString(),
      recipient: f.input.email,
      senderDomains: ["example.com"],
      ...page,
    });
    expect(pending.attempt).toMatchObject({ phase: "needs_user", reason: "mailbox_identity" });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    const next = await f.service.continue(
      f.userId,
      f.item().id,
      {
        expectedRevision: 1,
        action: "continue",
        mailboxConfirmation: { email: f.input.email, basis: "user_confirmed" },
      },
      "session_user",
    );
    const claim2 = (
      await f.queueClaims.claim(
        f.userId,
        f.claimInput(next.item.id, next.context.snapshot.snapshotHash),
      )
    ).claim!;
    const auth2 = `Bearer ${claim2.execution.accountSetup!.apiToken}`;
    await f.service.observe(auth2, {
      event: "mailbox_status",
      status: "mismatch",
      email: "someone@example.com",
      browserSessionId: claim2.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim2.leaseToken,
      status: "waiting",
    });
    await expect(
      f.service.continue(
        f.userId,
        f.item().id,
        {
          expectedRevision: 2,
          action: "continue",
          mailboxConfirmation: { email: f.input.email, basis: "user_confirmed" },
        },
        "session_user",
      ),
    ).rejects.toThrow("known mailbox mismatch");
    expect(storedAccountSetup(f.item()).attempt).toMatchObject({
      mailbox: null,
      mailboxBlocked: true,
      signupAttempts: 1,
    });
  });

  it("rejects a foreign browser, tenant, or URL containing verification secrets before storing anything", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const baseline = storedAccountSetup(f.item());
    for (const input of [
      { browserSessionId: crypto.randomUUID(), currentUrl: f.input.signupUrl },
      {
        browserSessionId: claim.ownership.browserSessionId,
        currentUrl: "https://other.example.com/signup",
      },
      {
        browserSessionId: claim.ownership.browserSessionId,
        currentUrl: `${f.input.signupUrl}?token=synthetic-verification-secret`,
      },
    ])
      await expect(
        f.service.observe(authorization, { event: "signup_form", ...input }),
      ).rejects.toThrow();
    expect(storedAccountSetup(f.item())).toEqual(baseline);
    expect(f.questions).toHaveLength(0);
  });
});
