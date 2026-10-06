import { randomBytes } from "node:crypto";
import type {
  EmailProvider,
  OAuthClientUpsertInput,
  RegisterConnectorAccountInput,
  SendEmailInput,
} from "@openapply/contracts/email";
import { singleton } from "tsyringe";
import { CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import {
  badRequest,
  conflict,
  ErrorCodes,
  findOwned,
  HttpError,
  unprocessable,
} from "@/common/errors";
import { env } from "@/env";
import { type EmailAccount, PrismaClient } from "@/generated/prisma/client";
import {
  accountCanSend,
  GMAIL_READ_SCOPE,
  GMAIL_SCOPES,
  getProvider,
  scopeCanRead,
} from "../gmail.provider";
import { loadFreshAccount, resolveOAuthClient } from "./account.utils";
import { getActiveEmailAccount, selectFirstEmailAccount } from "./account-selection";
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
  ) {}

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

  async send(userId: string, body: SendEmailInput) {
    const loaded = await loadFreshAccount(this.prisma, this.crypto, userId);
    if (!loaded) {
      throw new HttpError(ErrorCodes.NOT_FOUND, "No email account connected", 404);
    }
    const { account, config } = loaded;
    if (!accountCanSend(account)) {
      throw new HttpError(
        ErrorCodes.UNPROCESSABLE,
        "Connected mailbox lacks send access. Reconnect it from email settings to enable sending.",
        422,
      );
    }

    try {
      return await getProvider(account.provider).sendMessage(config, account, {
        to: body.to,
        subject: body.subject,
        body: body.body,
        threadId: body.threadId,
        attachments: body.attachments,
      });
    } catch (e) {
      throw new HttpError(
        ErrorCodes.UNPROCESSABLE,
        e instanceof Error ? e.message : "Failed to send message",
        502,
      );
    }
  }

  async buildAuthorizeUrl(
    userId: string,
    providerName: EmailProvider,
  ): Promise<{ authorizeUrl: string; state: string }> {
    if (providerName !== "gmail") {
      throw badRequest(`Unsupported provider: ${providerName}`);
    }

    const config = await resolveOAuthClient(this.prisma, this.crypto, userId);
    const state = randomBytes(16).toString("hex");
    let authorizeUrl: string;
    try {
      authorizeUrl = getProvider(providerName).getAuthorizeUrl(config, state);
    } catch (e) {
      throw new HttpError(
        ErrorCodes.UNPROCESSABLE,
        e instanceof Error ? e.message : "Email provider unavailable",
        400,
      );
    }

    return { authorizeUrl, state };
  }

  async completeEmailOAuth(input: {
    providerName: EmailProvider;
    code: string;
    userId: string;
  }): Promise<{ email: string }> {
    const { providerName, code, userId } = input;
    const provider = getProvider(providerName);
    const config = await resolveOAuthClient(this.prisma, this.crypto, userId);
    const { tokens, email } = await provider.exchangeCode(config, code);

    // Granular consent can drop a scope silently; storing that grant 403s every later sync.
    if (!scopeCanRead(tokens.scope)) {
      throw unprocessable(
        `Google did not grant ${GMAIL_READ_SCOPE}. Reconnect and allow every requested permission.`,
      );
    }

    const accessToken = await this.crypto.encryptFor(
      userId,
      SECRET_CONTEXTS.gmailTokens,
      tokens.accessToken,
    );
    const refreshToken =
      (await this.crypto.encryptField(userId, SECRET_CONTEXTS.gmailTokens, tokens.refreshToken)) ??
      null;
    const fields = {
      provider: providerName,
      email: email.trim().toLowerCase(),
      accessToken,
      refreshToken,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scope: tokens.scope ?? null,
      // A reconnect is exactly how a dead grant gets fixed.
      refreshFailedAt: null,
      lastCheckedAt: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const where = { userId_email: { userId, email: fields.email } };
      const existing = await tx.emailAccount.findUnique({ where });
      if (existing?.provider === "connector")
        throw conflict(
          "This mailbox already uses an agent connector. Remove it before changing its connection method.",
        );
      const account = await tx.emailAccount.upsert({
        where,
        create: { userId, ...fields },
        update: fields,
      });
      if (!existing) await selectFirstEmailAccount(tx, userId, account.id);
    });

    return { email };
  }

  // ── OAuth client config (bring-your-own Google app) ─────────────────────────

  /** Config status for the email settings UI. Never returns the client secret. */
  async getOAuthClient(userId: string) {
    const row = await this.prisma.emailOAuthClient.findUnique({ where: { userId } });
    return {
      configured: row !== null,
      provider: row?.provider ?? "gmail",
      clientId: row?.clientId ?? null,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      scopes: GMAIL_SCOPES,
    };
  }

  /** Create/update the client; a blank clientSecret keeps the stored one (required on first create). */
  async upsertOAuthClient(userId: string, input: OAuthClientUpsertInput) {
    const provider = input.provider ?? "gmail";
    if (provider !== "gmail") {
      throw badRequest(`Unsupported provider: ${provider}`);
    }

    const existing = await this.prisma.emailOAuthClient.findUnique({ where: { userId } });
    const plainSecret = input.clientSecret?.trim();

    let clientSecret: string;
    if (plainSecret) {
      clientSecret = await this.crypto.encryptFor(
        userId,
        SECRET_CONTEXTS.emailOAuthClient,
        plainSecret,
      );
    } else if (existing) {
      clientSecret = existing.clientSecret;
    } else {
      throw badRequest("Client secret is required");
    }

    await this.prisma.emailOAuthClient.upsert({
      where: { userId },
      create: { userId, provider, clientId: input.clientId, clientSecret },
      update: { provider, clientId: input.clientId, clientSecret },
    });

    return this.getOAuthClient(userId);
  }

  /** Remove the OAuth client. Blocked while a mailbox is still connected. */
  async deleteOAuthClient(userId: string) {
    const account = await this.prisma.emailAccount.findFirst({
      where: { userId, provider: { not: "connector" } },
    });
    if (account) {
      throw conflict("Disconnect the mailbox before removing its OAuth client.");
    }
    await this.prisma.emailOAuthClient.deleteMany({ where: { userId } });
    return { deleted: true };
  }
}
