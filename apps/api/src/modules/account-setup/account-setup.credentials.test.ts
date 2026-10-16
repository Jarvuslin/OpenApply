import { storedAccountSetup } from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("account setup secure credentials", () => {
  it("uses the saved job login itself without exposing its secret", async () => {
    const f = accountFixture();
    await expect(f.service.enqueue(f.userId, f.input, "agent")).rejects.toMatchObject({
      status: 403,
    });
    const { snapshot, item } = await f.enqueue();
    expect(snapshot.credentialId).toBe(f.credential.id);
    expect(f.credentials).toHaveLength(1);
    expect((await f.service.plan(f.userId, item.id)).snapshotHash).toBe(snapshot.snapshotHash);
    expect(f.secrets.reads).toBe(0);
    expect(JSON.stringify(await f.service.detail(f.userId, item.id))).not.toContain("encrypted.");
  });

  it("refuses any credential other than the job login", async () => {
    const f = accountFixture();
    f.credential.scope = "careers.example.com";
    await expect(f.enqueue()).rejects.toThrow("job login");
    expect(f.workItems).toHaveLength(0);
  });

  it("saves the correct existing password atomically and grants inspection only", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    const page = {
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    };
    await f.service.observe(authorization, { event: "existing_account", ...page });
    await expect(f.service.credential(authorization)).rejects.toThrow("credential use");
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    const input = { expectedRevision: 1, password: "correct-existing-secret" };
    await expect(
      f.service.saveCredentials(f.userId, f.item().id, input, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.saveCredentials(crypto.randomUUID(), f.item().id, input, "session_user"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.continue(
        f.userId,
        f.item().id,
        { expectedRevision: 1, action: "continue" },
        "session_user",
      ),
    ).rejects.toThrow("correct existing password");
    const saved = await f.service.saveCredentials(f.userId, f.item().id, input, "session_user");
    expect(saved.context.attempt).toMatchObject({
      phase: "checking",
      credentialPurpose: "existing",
      existingAccount: true,
      authenticatedAt: null,
      signupAttempts: 0,
    });
    expect(saved.context.snapshot).toMatchObject({ revision: 2, operation: "inspect" });
    expect(f.questions[0]).toMatchObject({
      status: "answered",
      answer: "Credentials saved securely",
    });
    expect(JSON.stringify({ saved, questions: f.questions, events: f.workEvents })).not.toContain(
      input.password,
    );
    const next = (
      await f.queueClaims.claim(
        f.userId,
        f.claimInput(saved.item.id, saved.context.snapshot.snapshotHash),
      )
    ).claim!;
    const nextAuth = `Bearer ${next.execution.accountSetup!.apiToken}`;
    await expect(f.service.begin(nextAuth)).rejects.toThrow();
    await expect(
      f.service.observe(nextAuth, {
        event: "signup_form",
        currentUrl: f.input.signupUrl,
        browserSessionId: next.ownership.browserSessionId,
      }),
    ).rejects.toThrow("existing account");
    expect((await f.service.credential(nextAuth)).credentialId).toBe(f.credential.id);
    expect(f.applications).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
  });

  it("rolls back the credential and answered question if queue continuation fails", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    await f.service.observe(authorization, {
      event: "existing_account",
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    const before = storedAccountSetup(f.item());
    const oldPassword = f.credential.password;
    const update = f.db.workItem.update;
    f.db.workItem.update = (() => {
      throw new Error("injected queue write failure");
    }) as typeof update;
    await expect(
      f.service.saveCredentials(
        f.userId,
        f.item().id,
        { expectedRevision: 1, password: "correct-existing-secret" },
        "session_user",
      ),
    ).rejects.toThrow("injected");
    f.db.workItem.update = update;
    expect(f.credential.password).toBe(oldPassword);
    expect(f.questions[0]).toMatchObject({ status: "open", answer: null });
    expect(storedAccountSetup(f.item())).toEqual(before);
    expect(f.item().state).toBe("needs_user");
  });
});
