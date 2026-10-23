import { storedAccountSetup } from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("account setup observations and human continuation", () => {
  it("does not confuse a visible signup form with account absence and permits only one begin", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await expect(f.service.begin(authorization)).rejects.toThrow();
    await f.service.observe(authorization, { event: "signup_form", ...page });
    const begins = await Promise.allSettled([
      f.service.begin(authorization),
      f.service.begin(authorization),
    ]);
    expect(begins.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(storedAccountSetup(f.item()).snapshot.accountStatus).toBe("unknown");
    expect(storedAccountSetup(f.item()).attempt.noAccountObserved).toBe(false);
    const duplicate = await f.service.observe(authorization, {
      event: "existing_account",
      ...page,
    });
    expect(duplicate.attempt).toMatchObject({
      phase: "needs_user",
      reason: "existing_account_credentials",
      signupAttempts: 1,
    });
    expect(f.questions).toHaveLength(1);
    expect(f.questions[0].subjectType).toBe("account_setup");
  });

  it("parks unknown outcomes and binds human inspection continuation to a fresh grant revision", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await f.service.observe(authorization, { event: "signup_form", ...page });
    await f.service.begin(authorization);
    await f.service.observe(authorization, { event: "unknown", ...page });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    await expect(
      f.service.continue(
        f.userId,
        f.item().id,
        { expectedRevision: 1, action: "continue" },
        "agent",
      ),
    ).rejects.toMatchObject({ status: 403 });
    const next = await f.service.continue(
      f.userId,
      f.item().id,
      { expectedRevision: 1, action: "continue" },
      "session_user",
    );
    expect(next.context.snapshot).toMatchObject({ revision: 2, operation: "inspect" });
    expect(next.context.attempt).toMatchObject({ signupAttempts: 1, authenticatedAt: null });
    expect(next.item.state).toBe("queued");
    await expect(
      f.queueClaims.claim(
        f.userId,
        f.claimInput(next.item.id, claim.execution.accountSetup!.snapshot.snapshotHash),
      ),
    ).rejects.toThrow("snapshot hash");
    const nextClaim = (
      await f.queueClaims.claim(
        f.userId,
        f.claimInput(next.item.id, next.context.snapshot.snapshotHash),
      )
    ).claim!;
    await expect(
      f.service.begin(`Bearer ${nextClaim.execution.accountSetup!.apiToken}`),
    ).rejects.toThrow();
    await expect(
      f.service.credential(`Bearer ${nextClaim.execution.accountSetup!.apiToken}`),
    ).rejects.toThrow("credential use");
  });

  it("recovers an interrupted signup into a durable question and never another signup", async () => {
    const f = accountFixture();
    const { authorization } = await f.start();
    const browserSessionId = String(f.workExecutions[0].browserSessionId);
    await f.service.observe(authorization, {
      event: "no_account",
      browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    await f.service.begin(authorization);
    f.item().leaseExpiresAt = new Date(0);
    await f.queue.refresh(f.userId);
    expect(f.item().state).toBe("needs_user");
    expect(storedAccountSetup(f.item()).attempt).toMatchObject({
      phase: "unknown",
      signupAttempts: 1,
      noAccountObserved: true,
    });
    expect(f.questions).toHaveLength(1);
    await f.queue.refresh(f.userId);
    expect(f.questions).toHaveLength(1);
    const next = await f.service.continue(
      f.userId,
      f.item().id,
      { expectedRevision: 1, action: "continue" },
      "session_user",
    );
    expect(next.context.snapshot.operation).toBe("inspect");
    expect(next.context.attempt.authenticatedAt).toBeNull();
  });

  it("rejects expired, cancelled, answered or missing human handoffs and permits explicit skip", async () => {
    for (const mutation of ["expired", "cancelled", "answered", "missing"]) {
      const f = accountFixture();
      const { authorization, claim } = await f.start();
      await f.service.observe(authorization, {
        event: "needs_user",
        reason: "terms_confirmation",
        browserSessionId: claim.ownership.browserSessionId,
        currentUrl: f.input.signupUrl,
      });
      await f.queue.finish(f.userId, f.item().id, {
        leaseToken: claim.leaseToken,
        status: "waiting",
      });
      if (mutation === "expired") f.questions[0].expiresAt = new Date(0);
      else if (mutation === "missing") f.questions.splice(0);
      else f.questions[0].status = mutation;
      await expect(
        f.service.continue(
          f.userId,
          f.item().id,
          { expectedRevision: 1, action: "continue" },
          "session_user",
        ),
      ).rejects.toThrow("no longer open");
      const skipped = await f.service.continue(
        f.userId,
        f.item().id,
        { expectedRevision: 1, action: "skip" },
        "session_user",
      );
      expect(skipped.item.state).toBe("skipped");
      expect(skipped.context.attempt.phase).toBe("skipped");
      await expect(
        f.service.continue(
          f.userId,
          f.item().id,
          { expectedRevision: 1, action: "continue" },
          "session_user",
        ),
      ).rejects.toThrow();
    }
  });

  it("does not create orphan questions or consume signup when the atomic observation write fails", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const update = f.db.workItem.update;
    f.db.workItem.update = (() => {
      throw new Error("injected observation failure");
    }) as typeof update;
    await expect(
      f.service.observe(authorization, {
        event: "needs_user",
        reason: "password_entry",
        browserSessionId: claim.ownership.browserSessionId,
        currentUrl: f.input.signupUrl,
      }),
    ).rejects.toThrow("injected");
    f.db.workItem.update = update;
    expect(f.questions).toHaveLength(0);
    expect(storedAccountSetup(f.item()).attempt).toMatchObject({
      phase: "checking",
      signupAttempts: 0,
      questionId: null,
    });
  });

  it("keeps the signup latch after manual password handoff and allows only one concurrent continuation", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await f.service.observe(authorization, { event: "signup_form", ...page });
    await f.service.begin(authorization);
    await f.service.observe(authorization, {
      event: "needs_user",
      reason: "password_entry",
      ...page,
    });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        f.service.continue(
          f.userId,
          f.item().id,
          { expectedRevision: 1, action: "continue" },
          "session_user",
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(storedAccountSetup(f.item()).snapshot).toMatchObject({
      revision: 2,
      operation: "inspect",
    });
    expect(storedAccountSetup(f.item()).attempt).toMatchObject({
      signupAttempts: 1,
      authenticatedAt: null,
    });
    expect(f.workExecutions).toHaveLength(1);
  });
});
