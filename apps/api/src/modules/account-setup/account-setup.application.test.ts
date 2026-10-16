import type { Prisma } from "@/generated/prisma/client";
import { resumeWaitingApplications, waitingAccountId } from "./account-setup.parent";
import { storedAccountSetup } from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

const request = {
  signupUrl: "https://careers.example.com/signup",
  tenantOrigin: "https://careers.example.com",
};

function withRunningApplication(mailbox: string | null = "applicant@example.com") {
  const f = accountFixture();
  const leaseToken = crypto.randomUUID();
  const application = {
    id: crypto.randomUUID(),
    userId: f.userId,
    kind: "application",
    state: "filling",
    leaseToken,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    payload: {},
    reason: null as string | null,
    createdAt: new Date(),
  };
  f.workItems.push(application);
  Object.assign(f.db, {
    user: {
      findUnique: async () => ({ activeEmailAccount: mailbox ? { email: mailbox } : null }),
    },
  });
  return { ...f, application, leaseToken };
}

describe("account setup requested by a running application", () => {
  it("creates the account with the job login and parks the application behind it", async () => {
    const f = withRunningApplication();
    const result = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    const account = f.workItems.find((row) => row.id === result.accountWorkItemId)!;
    const { snapshot, attempt } = storedAccountSetup(account as never);
    expect(snapshot.credentialId).toBe(f.credential.id);
    expect(snapshot.operation).toBe("signup");
    expect(attempt.mailbox?.email).toBe("applicant@example.com");
    expect(waitingAccountId(f.application as never)).toBe(account.id as string);
    expect(f.application.reason).toBe("Creating your account on careers.example.com");
    const again = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    expect(again.accountWorkItemId).toBe(result.accountWorkItemId);
    expect(f.workItems.filter((row) => row.intent === "account_setup")).toHaveLength(1);
  });

  it("replaces an account step that stopped before any signup was sent", async () => {
    const f = withRunningApplication();
    const first = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    const stale = f.workItems.find((row) => row.id === first.accountWorkItemId)!;
    stale.state = "needs_user";
    const again = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    expect(again.accountWorkItemId).not.toBe(first.accountWorkItemId);
    expect(f.workItems.filter((row) => row.intent === "account_setup")).toHaveLength(1);
  });

  it("continues a sent signup that waits on its email without a person, a few times", async () => {
    const f = withRunningApplication();
    const { accountWorkItemId } = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    const account = f.workItems.find((row) => row.id === accountWorkItemId)!;
    function park() {
      const context = storedAccountSetup(account as never);
      const questionId = crypto.randomUUID();
      f.questions.push({
        id: questionId,
        userId: f.userId,
        subjectType: "account_setup",
        subjectId: account.id,
        status: "open",
        expiresAt: null,
      });
      account.state = "needs_user";
      account.payload = {
        ...context,
        attempt: {
          ...context.attempt,
          phase: "needs_user",
          reason: "verification",
          signupAttempts: 1,
          begunAt: new Date(),
          questionId,
        },
      };
    }
    for (let pass = 0; pass < 4; pass++) {
      park();
      await f.service.autoContinue(f.userId);
      expect(account.state).toBe("queued");
    }
    park();
    await f.service.autoContinue(f.userId);
    expect(account.state).toBe("needs_user");
  });

  it("leaves the mailbox unconfirmed when Gmail is a different address", async () => {
    const f = withRunningApplication("other@example.com");
    const result = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    const account = f.workItems.find((row) => row.id === result.accountWorkItemId)!;
    expect(storedAccountSetup(account as never).attempt.mailbox).toBeNull();
  });

  it("refuses a stale lease or a missing job login", async () => {
    const f = withRunningApplication();
    await expect(
      f.service.requestForApplication(f.userId, f.application.id, crypto.randomUUID(), request),
    ).rejects.toMatchObject({ status: 409 });
    f.credential.password = "";
    await expect(
      f.service.requestForApplication(f.userId, f.application.id, f.leaseToken, request),
    ).rejects.toThrow("job login");
    expect(f.workItems.filter((row) => row.intent === "account_setup")).toHaveLength(0);
  });

  it("requeues the waiting application once the account exists", async () => {
    const f = withRunningApplication();
    const { accountWorkItemId } = await f.service.requestForApplication(
      f.userId,
      f.application.id,
      f.leaseToken,
      request,
    );
    f.application.state = "needs_user";
    const resumed = await resumeWaitingApplications(
      f.db as unknown as Prisma.TransactionClient,
      f.userId,
      accountWorkItemId,
    );
    expect(resumed).toEqual([f.application.id]);
    expect(f.application).toMatchObject({ state: "queued", reason: null, payload: {} });
  });
});
