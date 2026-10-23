import type { RegisterConnectorAccountInput } from "@openapply/contracts/email";
import { singleton } from "tsyringe";
import { findOwned } from "@/common/errors";
import { type EmailAccount, PrismaClient } from "@/generated/prisma/client";
import { accountCanSend } from "../gmail.provider";
import { getActiveEmailAccount } from "./account-selection";
import { saveConnectorAccount } from "./connector-account";

function mailboxStatus(account: EmailAccount, selected: boolean) {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    runtimeProvider: account.runtimeProvider,
    identityVerified: account.identityVerified,
    lastCheckedAt: account.lastCheckedAt,
    lastSyncAt: account.lastSyncAt,
    canSend: accountCanSend(account),
    needsReauth: account.refreshFailedAt !== null,
    selected,
  };
}

@singleton()
export class EmailAccountService {
  constructor(private readonly prisma: PrismaClient) {}

  async accountStatus(userId: string) {
    const account = await getActiveEmailAccount(this.prisma, userId);

    if (!account) {
      return { connected: false as const, canSend: false };
    }

    return {
      connected: true as const,
      ...mailboxStatus(account, true),
    };
  }

  async listAccounts(userId: string) {
    const rows = await this.prisma.emailAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { activeForUser: { select: { id: true } } },
    });
    return rows.map((row) => mailboxStatus(row, row.activeForUser?.id === userId));
  }

  async registerConnectorAccount(userId: string, input: RegisterConnectorAccountInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const account = await saveConnectorAccount(tx, userId, {
        ...input,
        identityVerified: input.identityVerified ?? false,
      });
      const selected = await getActiveEmailAccount(tx, userId);
      return mailboxStatus(account, selected?.id === account.id);
    });
  }

  async selectAccount(userId: string, accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const account = await findOwned(
        (where) => tx.emailAccount.findFirst({ where }),
        { id: accountId, userId },
        "Mailbox",
      );
      await tx.user.update({ where: { id: userId }, data: { activeEmailAccountId: account.id } });
      return { connected: true as const, ...mailboxStatus(account, true) };
    });
  }

  async disconnectAccount(userId: string, accountId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const account = accountId
        ? await findOwned(
            (where) => tx.emailAccount.findFirst({ where }),
            { id: accountId, userId },
            "Mailbox",
          )
        : await getActiveEmailAccount(tx, userId);
      if (!account) return;
      await tx.user.updateMany({
        where: { id: userId, activeEmailAccountId: account.id },
        data: { activeEmailAccountId: null },
      });
      await tx.emailAccount.delete({ where: { id: account.id } });
    });
    return { disconnected: true };
  }
}
