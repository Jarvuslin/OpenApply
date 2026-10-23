import { assertSubmissionLease } from "@/modules/work-queue/submission-fence";
import { storedAccountSetup, validateAccountSetup } from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("account setup execution fence", () => {
  it("claims only its exact hash and emits no job, submission grant, secret, or other task", async () => {
    const f = accountFixture();
    const result = await f.enqueue();
    await expect(f.queueClaims.claim(f.userId, f.claimInput(result.item.id))).rejects.toThrow(
      "snapshot hash",
    );
    await expect(
      f.queueClaims.claim(f.userId, f.claimInput(result.item.id, "0".repeat(64))),
    ).rejects.toThrow("snapshot hash");
    const input = f.claimInput(result.item.id, result.snapshot.snapshotHash);
    await expect(
      f.queueClaims.claim(f.userId, { ...input, capabilities: { isolatedBrowser: true } }),
    ).rejects.toThrow("account-capable runtime");
    const claim = (await f.queueClaims.claim(f.userId, input)).claim!;
    expect((await f.queueClaims.claim(f.userId, input)).claim).toEqual(claim);
    expect(claim.execution).toMatchObject({
      job: null,
      preparation: null,
      providerSessionId: null,
      accountSetup: { snapshot: result.snapshot },
    });
    expect(claim.execution.instructions).toContain("no application submission permission");
    await f.queue.event(f.userId, result.item.id, {
      leaseToken: claim.leaseToken,
      eventId: crypto.randomUUID(),
      kind: "activity",
      content: "synthetic-password-never-in-context",
      providerSessionId: "synthetic-password-never-in-context",
    });
    expect(f.workExecutions).toHaveLength(1);
    expect(f.workExecutions[0].jobId).toBeNull();
    const authorization = `Bearer ${claim.execution.accountSetup!.apiToken}`;
    const context = await f.service.context(authorization);
    expect(
      JSON.stringify({ claim, context, rows: f.workItems, events: f.workEvents }),
    ).not.toContain("synthetic-password");
    expect(JSON.stringify(f.workItems)).not.toContain(f.credential.password);
    await expect(
      assertSubmissionLease(f.db, f.userId, crypto.randomUUID(), result.item.id, claim.leaseToken),
    ).rejects.toThrow("does not authorize submission");
    expect(f.applications).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
  });

  it("consumes begin once before browser mutation and preserves it after ambiguous completion", async () => {
    const f = accountFixture();
    const { authorization, claim } = await f.start();
    await f.service.observe(authorization, {
      event: "signup_form",
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    const outcomes = await Promise.allSettled([
      f.service.begin(authorization),
      f.service.begin(authorization),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await f.service.context(authorization)).attempt).toMatchObject({
      signupAttempts: 1,
      outcome: null,
    });
    const finished = await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "completed",
      error: "synthetic-password-never-in-context",
    });
    expect(finished.state).toBe("needs_user");
    expect(JSON.stringify(f.workItems)).not.toContain("synthetic-password-never-in-context");
    expect(storedAccountSetup(f.item()).attempt.signupAttempts).toBe(1);
    await expect(f.queue.control(f.userId, f.item().id, "resume")).rejects.toThrow("cannot resume");
    await expect(f.service.context(authorization)).rejects.toThrow("stopped");
    expect(f.workExecutions).toHaveLength(1);
  });

  it("completes only after live authenticated evidence, never an already-existing account", async () => {
    for (const outcome of [null, "created", "verification_pending"] as const) {
      const f = accountFixture();
      const { authorization, claim } = await f.start();
      const page = {
        browserSessionId: claim.ownership.browserSessionId,
        currentUrl: f.input.signupUrl,
      };
      if (outcome === "created") {
        await f.service.observe(authorization, {
          event: "authenticated",
          evidence: "authenticated_session",
          ...page,
        });
      } else if (outcome === "verification_pending") {
        await f.service.observe(authorization, { event: "signup_form", ...page });
        await f.service.begin(authorization);
        await f.service.observe(authorization, {
          event: "verification_pending",
          requestedAt: new Date().toISOString(),
          recipient: f.input.email,
          senderDomains: ["example.com"],
          ...page,
        });
      }
      const done = await f.queue.finish(f.userId, f.item().id, {
        leaseToken: claim.leaseToken,
        status: "completed",
      });
      expect(done.state).toBe(outcome === "created" ? "completed" : "needs_user");
      expect(f.applications).toHaveLength(0);
    }
  });

  it("fails closed on expiry, revocation, replaced execution, or changed credential", async () => {
    const mutations = [
      (f: ReturnType<typeof accountFixture>) => {
        f.item().leaseExpiresAt = new Date(0);
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.item().leaseToken = crypto.randomUUID();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.item().currentExecutionId = crypto.randomUUID();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.item().cancellationRequestedAt = new Date();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.item().pauseRequestedAt = new Date();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.workExecutions[0].finishedAt = new Date();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.workExecutions[0].releasedAt = new Date();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.credential.userId = crypto.randomUUID();
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.credential.email = "changed@example.com";
      },
      (f: ReturnType<typeof accountFixture>) => {
        f.credential.scope = "careers.example.com";
      },
    ];
    for (const mutate of mutations) {
      const f = accountFixture();
      const { authorization } = await f.start();
      mutate(f);
      await expect(f.service.begin(authorization)).rejects.toThrow();
      await expect(f.service.credential(authorization)).rejects.toThrow();
      expect(storedAccountSetup(f.item()).attempt.signupAttempts).toBe(0);
      expect(f.secrets.reads).toBe(0);
    }
  });

  it("rechecks liveness after internal secret resolution and keeps the password out of safe context", async () => {
    const f = accountFixture();
    const { authorization } = await f.start();
    expect(await f.service.credential(authorization)).toEqual({
      credentialId: f.credential.id,
      email: f.credential.email,
      password: "synthetic-password-never-in-context",
    });
    f.secrets.afterRead = () => {
      f.item().leaseExpiresAt = new Date(0);
    };
    await expect(f.service.credential(authorization)).rejects.toThrow("lease");
  });

  it("rejects previous executions even when a row is forged back to fresh and blocks ordered eligibility", async () => {
    const f = accountFixture();
    const { item } = await f.enqueue();
    f.workExecutions.push({
      id: crypto.randomUUID(),
      userId: f.userId,
      workItemId: item.id,
      kind: "pilot_task",
      finishedAt: new Date(),
    });
    await expect(validateAccountSetup(f.db, f.userId, f.item())).rejects.toThrow(
      "no retry or resume",
    );
    expect((await f.reader.ordered(f.userId, { workItemIds: [item.id] })).items[0].eligible).toBe(
      false,
    );
    await expect(f.service.plan(crypto.randomUUID(), item.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
