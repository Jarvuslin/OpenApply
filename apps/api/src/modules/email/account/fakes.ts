import type { EmailAccount, PrismaClient } from "@/generated/prisma/client";

interface AccountWhere {
  id?: string;
  userId?: string;
  userId_email?: { userId: string; email: string };
  activeForUser?: { id: string };
  provider?: string | { not: string };
}

type StoredMessage = { accountId: string; providerId: string } & Record<string, unknown>;
type AccountInput = Pick<EmailAccount, "email" | "userId"> & Partial<EmailAccount>;

export function createMailboxFixture() {
  const accounts = new Map<string, EmailAccount>();
  const messages = new Map<string, StoredMessage>();
  const activeForUser = new Map<string, string | null>();
  let sequence = 0;

  function seedAccount(input: AccountInput, selected = false) {
    const row: EmailAccount = {
      id: `account-${++sequence}`,
      provider: "connector",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scope: null,
      historyId: null,
      lastSyncAt: null,
      lastCheckedAt: null,
      runtimeProvider: null,
      refreshFailedAt: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      ...input,
      identityVerified: input.identityVerified ?? false,
    };
    accounts.set(row.id, row);
    if (selected) activeForUser.set(row.userId, row.id);
    return row;
  }

  function seedMessage(message: StoredMessage) {
    messages.set(`${message.accountId}:${message.providerId}`, message);
  }

  function matching(where: AccountWhere) {
    return [...accounts.values()].filter((row) => {
      if (where.id && row.id !== where.id) return false;
      if (where.userId && row.userId !== where.userId) return false;
      if (
        where.userId_email &&
        (row.userId !== where.userId_email.userId || row.email !== where.userId_email.email)
      )
        return false;
      if (where.activeForUser && activeForUser.get(where.activeForUser.id) !== row.id) return false;
      if (typeof where.provider === "string") return row.provider === where.provider;
      if (where.provider?.not) return row.provider !== where.provider.not;
      return true;
    });
  }

  const db = {
    $queryRaw: async () => [],
    emailAccount: {
      findFirst: async ({ where }: { where: AccountWhere }) => matching(where)[0] ?? null,
      findUnique: async ({ where }: { where: AccountWhere }) => matching(where)[0] ?? null,
      findMany: async ({ where }: { where: AccountWhere }) =>
        matching(where)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((row) => ({
            ...row,
            activeForUser: activeForUser.get(row.userId) === row.id ? { id: row.userId } : null,
          })),
      count: async ({ where }: { where: AccountWhere }) => matching(where).length,
      create: async ({ data }: { data: AccountInput }) => {
        if (matching({ userId_email: data }).length) throw new Error("Duplicate mailbox");
        return seedAccount(data);
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<EmailAccount> }) => {
        const existing = accounts.get(where.id);
        if (!existing) throw new Error("Mailbox not found");
        const values = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        );
        const row = { ...existing, ...values };
        accounts.set(row.id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = accounts.get(where.id);
        if (!row) throw new Error("Mailbox not found");
        accounts.delete(where.id);
        for (const [key, message] of messages) {
          if (message.accountId === where.id) messages.delete(key);
        }
        for (const [userId, selected] of activeForUser) {
          if (selected === where.id) activeForUser.set(userId, null);
        }
        return row;
      },
    },
    user: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { activeEmailAccountId: string | null };
      }) => {
        activeForUser.set(where.id, data.activeEmailAccountId);
        return { id: where.id, ...data };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; activeEmailAccountId: string };
        data: { activeEmailAccountId: string | null };
      }) => {
        if (activeForUser.get(where.id) !== where.activeEmailAccountId) return { count: 0 };
        activeForUser.set(where.id, data.activeEmailAccountId);
        return { count: 1 };
      },
    },
    emailMessage: {
      createMany: async ({ data }: { data: StoredMessage[] }) => {
        let count = 0;
        for (const row of data) {
          const key = `${row.accountId}:${row.providerId}`;
          if (!messages.has(key)) {
            messages.set(key, row);
            count++;
          }
        }
        return { count };
      },
    },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => {
      const snapshot = {
        accounts: new Map(accounts),
        messages: new Map(messages),
        activeForUser: new Map(activeForUser),
      };
      try {
        return await run(db);
      } catch (error) {
        accounts.clear();
        messages.clear();
        activeForUser.clear();
        for (const [key, value] of snapshot.accounts) accounts.set(key, value);
        for (const [key, value] of snapshot.messages) messages.set(key, value);
        for (const [key, value] of snapshot.activeForUser) activeForUser.set(key, value);
        throw error;
      }
    },
  } as unknown as PrismaClient;
  return { prisma, accounts, messages, activeForUser, seedAccount, seedMessage };
}
