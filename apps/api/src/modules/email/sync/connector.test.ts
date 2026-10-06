import { ingestMessagesSchema } from "@openapply/contracts/email";
import type { CryptoService } from "@/common/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { EmailAccountService } from "../account/account.service";
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
function fixture(provider?: "gmail" | "connector") {
  let account: { id: string; provider: string; email: string; lastSyncAt: Date | null } | null =
    provider ? { id: "account", provider, email: "applicant@example.com", lastSyncAt: null } : null;
  const saved = new Map<string, object>();
  const db = {
    $queryRaw: async () => [],
    emailAccount: {
      findUnique: async () => account,
      create: async ({ data }: { data: { provider: string; email: string } }) =>
        (account = { id: "account", ...data, lastSyncAt: null }),
      update: async ({ data }: { data: { lastSyncAt: Date } }) => {
        if (account) account.lastSyncAt = data.lastSyncAt;
      },
    },
    emailMessage: {
      createMany: async ({ data }: { data: { accountId: string; providerId: string }[] }) => {
        let count = 0;
        for (const m of data) {
          const id = `${m.accountId}:${m.providerId}`;
          if (!saved.has(id)) {
            saved.set(id, m);
            count++;
          }
        }
        return { count };
      },
    },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  } as unknown as PrismaClient;
  return {
    sync: new EmailSyncService(prisma, {} as CryptoService),
    send: new EmailAccountService(prisma, {} as CryptoService),
    account: () => account,
    saved,
  };
}
describe("agent mailbox ingest", () => {
  it("creates an account and ignores duplicate provider ids on repeated uploads", async () => {
    const { sync, account, saved } = fixture();
    const input = { mailbox: "applicant@example.com", messages: [message, message] };
    expect(await sync.ingest("user", input)).toEqual({ fetched: 2, new: 1 });
    expect(await sync.ingest("user", input)).toEqual({ fetched: 2, new: 0 });
    expect(account()?.provider).toBe("connector");
    expect(account()?.lastSyncAt).toBeInstanceOf(Date);
    expect(saved.size).toBe(1);
  });
  it("refuses OAuth and unexpected mailbox identity without writing messages", async () => {
    for (const provider of ["gmail", "connector"] as const) {
      const { sync, saved } = fixture(provider);
      await expect(
        sync.ingest("user", { mailbox: "different@example.com", messages: [message] }),
      ).rejects.toMatchObject({ status: 409 });
      expect(saved.size).toBe(0);
    }
  });
  it("requires connector tools for sending and syncing and skips background sync", async () => {
    const { sync, send } = fixture("connector");
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
