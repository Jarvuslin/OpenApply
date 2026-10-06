import { ingestMessagesSchema } from "@openapply/contracts/email";
import type { CryptoService } from "@/common/crypto";
import { EmailAccountService } from "../account/account.service";
import { createMailboxFixture } from "../account/fakes";
import { EmailSyncService } from "./sync.service";
import { describe, expect, it } from "bun:test";

const message = {
  providerId: "mail-1",
  threadId: null,
  subject: "Application received",
  fromAddress: "jobs@example.com",
  fromName: null,
  fromDomain: "example.com",
  snippet: "Thanks",
  rawBody: "Thanks",
  receivedAt: new Date(),
};
function fixture() {
  const state = createMailboxFixture();
  return {
    ...state,
    sync: new EmailSyncService(state.prisma, {} as CryptoService),
    send: new EmailAccountService(state.prisma, {} as CryptoService),
  };
}
describe("agent mailbox ingest", () => {
  it("creates an account and ignores duplicate provider ids on repeated uploads", async () => {
    const { sync, accounts, messages, activeForUser } = fixture();
    const input = {
      mailbox: "applicant@example.com",
      runtimeProvider: "claude" as const,
      messages: [message, message],
    };
    expect(await sync.ingest("user", input)).toEqual({ fetched: 2, new: 1 });
    expect(await sync.ingest("user", input)).toEqual({ fetched: 2, new: 0 });
    const account = [...accounts.values()][0];
    expect(account?.provider).toBe("connector");
    expect(account?.runtimeProvider).toBe("claude");
    expect(account?.identityVerified).toBe(false);
    expect(account?.lastCheckedAt).toBeInstanceOf(Date);
    expect(account?.lastSyncAt).toBeInstanceOf(Date);
    expect(activeForUser.get("user")).toBe(account?.id);
    expect(messages.size).toBe(1);
  });

  it("keeps identical provider IDs in different mailboxes without changing selection", async () => {
    const { sync, accounts, messages, activeForUser } = fixture();
    await sync.ingest("user", {
      mailbox: "first@example.com",
      runtimeProvider: "claude",
      messages: [message],
    });
    const originalSelection = activeForUser.get("user");

    expect(
      await sync.ingest("user", {
        mailbox: "second@example.com",
        runtimeProvider: "codex",
        messages: [message],
      }),
    ).toEqual({ fetched: 1, new: 1 });
    expect(
      await sync.ingest("user", {
        mailbox: "second@example.com",
        messages: [message],
      }),
    ).toEqual({ fetched: 1, new: 0 });

    expect(accounts.size).toBe(2);
    expect(messages.size).toBe(2);
    expect(new Set([...messages.values()].map(({ accountId }) => accountId)).size).toBe(2);
    expect(activeForUser.get("user")).toBe(originalSelection);
    expect(
      [...accounts.values()].find(({ email }) => email === "second@example.com")?.runtimeProvider,
    ).toBe("codex");
  });

  it("rejects an OAuth mailbox with the same address but allows another connector mailbox", async () => {
    const { sync, seedAccount, accounts, messages, activeForUser } = fixture();
    const oauth = seedAccount(
      { userId: "user", provider: "gmail", email: "oauth@example.com" },
      true,
    );

    await expect(
      sync.ingest("user", {
        mailbox: "oauth@example.com",
        messages: [message],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(messages.size).toBe(0);
    expect(
      await sync.ingest("user", {
        mailbox: "connector@example.com",
        messages: [message],
      }),
    ).toEqual({ fetched: 1, new: 1 });

    expect(accounts.size).toBe(2);
    expect(accounts.get(oauth.id)?.provider).toBe("gmail");
    expect(activeForUser.get("user")).toBe(oauth.id);
  });

  it("rejects a verified mailbox that does not match the explicitly requested account", async () => {
    const { sync, seedAccount, accounts, messages, activeForUser } = fixture();
    const own = seedAccount({ userId: "user", email: "intended@example.com" }, true);

    await expect(
      sync.ingest("user", {
        accountId: own.id,
        mailbox: "different@example.com",
        messages: [message],
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(accounts.size).toBe(1);
    expect(accounts.get(own.id)?.lastCheckedAt).toBeNull();
    expect(messages.size).toBe(0);
    expect(activeForUser.get("user")).toBe(own.id);
  });

  it("rejects foreign or nonexistent account IDs before importing any messages", async () => {
    const { sync, seedAccount, accounts, messages, activeForUser } = fixture();
    const foreign = seedAccount({ userId: "other-user", email: "other@example.com" }, true);
    for (const accountId of [foreign.id, "missing-account"]) {
      await expect(
        sync.ingest("user", { accountId, mailbox: "other@example.com", messages: [message] }),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(accounts.size).toBe(1);
    expect(messages.size).toBe(0);
    expect(activeForUser.get("other-user")).toBe(foreign.id);
    expect(activeForUser.get("user")).toBeUndefined();
  });

  it("imports into an explicitly requested saved mailbox without clearing verified identity or changing selection", async () => {
    const { sync, seedAccount, accounts, messages, activeForUser } = fixture();
    const selected = seedAccount({ userId: "user", email: "selected@example.com" }, true);
    const saved = seedAccount({
      userId: "user",
      email: "saved@example.com",
      runtimeProvider: "codex",
      identityVerified: true,
    });

    await sync.ingest("user", {
      accountId: saved.id,
      mailbox: "SAVED@example.com",
      messages: [message],
    });

    expect([...messages.values()].map(({ accountId }) => accountId)).toEqual([saved.id]);
    expect(accounts.get(saved.id)?.runtimeProvider).toBe("codex");
    expect(accounts.get(saved.id)?.identityVerified).toBe(true);
    expect(accounts.get(saved.id)?.lastSyncAt).toBeInstanceOf(Date);
    expect(accounts.get(selected.id)?.lastSyncAt).toBeNull();
    expect(activeForUser.get("user")).toBe(selected.id);
  });

  it("requires connector tools for sending and syncing and skips background sync", async () => {
    const { sync, send, seedAccount } = fixture();
    seedAccount({ userId: "user", email: "applicant@example.com" }, true);
    await expect(sync.syncInbox("user")).rejects.toMatchObject({ status: 409 });
    await expect(
      send.send("user", { to: "jobs@example.com", subject: "Reply", body: "Thanks" }),
    ).rejects.toMatchObject({ status: 409 });
    let called = false;
    sync.syncInbox = async () => {
      called = true;
      return { fetched: 0, new: 0 };
    };
    await sync.syncIfStale("user", 0, new Date());
    expect(called).toBe(false);
  });
  it("accepts ISO dates and rejects oversized batches and mismatched sender domains", () => {
    expect(
      ingestMessagesSchema.parse({
        mailbox: "applicant@example.com",
        messages: [{ ...message, receivedAt: new Date().toISOString() }],
      }).messages[0].receivedAt,
    ).toBeInstanceOf(Date);
    expect(
      ingestMessagesSchema.safeParse({
        mailbox: "applicant@example.com",
        messages: Array(101).fill(message),
      }).success,
    ).toBe(false);
    expect(
      ingestMessagesSchema.safeParse({
        mailbox: "applicant@example.com",
        messages: [{ ...message, fromDomain: "trusted.example" }],
      }).success,
    ).toBe(false);
  });
});
