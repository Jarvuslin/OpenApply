import { type CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import { conflict, ErrorCodes, HttpError } from "@/common/errors";
import { env } from "@/env";
import { type EmailAccount, type PrismaClient } from "@/generated/prisma/client";
import type { OAuthClientConfig } from "../email.provider";
import { getProvider } from "../gmail.provider";

/** Resolve the user's own Google OAuth client; 400s if unconfigured (no shared client). Redirect URI is env-derived. */
export async function resolveOAuthClient(
  prisma: PrismaClient,
  crypto: CryptoService,
  userId: string,
): Promise<OAuthClientConfig> {
  const row = await prisma.emailOAuthClient.findUnique({ where: { userId } });
  if (!row) {
    throw new HttpError(
      ErrorCodes.UNPROCESSABLE,
      "No Google OAuth client configured. Add your Client ID and Secret in email settings.",
      400,
    );
  }

  const clientSecret = await crypto.decryptFor(
    userId,
    SECRET_CONTEXTS.emailOAuthClient,
    row.clientSecret,
  );
  return { clientId: row.clientId, clientSecret, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI };
}

/**
 * Load the user's connected email account with its OAuth tokens decrypted for
 * use, refreshing the access token first when expired (and re-encrypting the
 * refreshed tokens at rest). Returns `null` when no account is connected. Shared
 * by the account (send) and sync services so neither duplicates the refresh dance.
 *
 * Returns the resolved OAuth `config` alongside the account so callers reuse it
 * instead of resolving the same row again.
 */
export async function loadFreshAccount(
  prisma: PrismaClient,
  crypto: CryptoService,
  userId: string,
): Promise<{ account: EmailAccount; config: OAuthClientConfig } | null> {
  const account = await prisma.emailAccount.findUnique({ where: { userId } });
  if (!account) {
    return null;
  }

  if (account.provider === "connector")
    throw conflict(
      "Use your agent's Gmail connector to pull or send mail. Upload received messages to /api/email/messages/ingest.",
    );
  const decrypt = (value: string | null) =>
    crypto.decryptField(userId, SECRET_CONTEXTS.gmailTokens, value);

  const plain: EmailAccount = {
    ...account,
    accessToken: await decrypt(account.accessToken),
    refreshToken: await decrypt(account.refreshToken),
  };
  const config = await resolveOAuthClient(prisma, crypto, userId);

  const expired = account.tokenExpiresAt !== null && account.tokenExpiresAt <= new Date();
  if (!plain.refreshToken || !expired) {
    return { account: plain, config };
  }
  const fresh = await refreshTokens(prisma, crypto, userId, plain, plain.refreshToken, config);
  return { account: fresh, config };
}

/**
 * Refresh the expired access token and persist it re-encrypted. A rejected refresh (invalid_grant)
 * stamps `refreshFailedAt` so status reports the mailbox needs reconnecting; success clears it.
 */
async function refreshTokens(
  prisma: PrismaClient,
  crypto: CryptoService,
  userId: string,
  account: EmailAccount,
  refreshToken: string,
  config: OAuthClientConfig,
): Promise<EmailAccount> {
  const provider = getProvider(account.provider);
  let refreshed: Awaited<ReturnType<typeof provider.refresh>>;
  try {
    refreshed = await provider.refresh(config, refreshToken);
  } catch (err) {
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { refreshFailedAt: account.refreshFailedAt ?? new Date() },
    });
    throw err;
  }

  const fresh = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    tokenExpiresAt: refreshed.expiresAt ?? null,
    scope: refreshed.scope ?? account.scope,
    refreshFailedAt: null,
  };
  const encrypt = (value: string) => crypto.encryptFor(userId, SECRET_CONTEXTS.gmailTokens, value);
  await prisma.emailAccount.update({
    where: { id: account.id },
    data: {
      ...fresh,
      accessToken: await encrypt(fresh.accessToken),
      refreshToken: await encrypt(fresh.refreshToken),
    },
  });
  return { ...account, ...fresh };
}
