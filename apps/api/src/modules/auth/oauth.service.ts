import type { OAuthErrorReason, OAuthProviderInput } from "@jobpilot/contracts";
import { singleton } from "tsyringe";
import { conflict, notFound } from "@/common/errors";
import { env } from "@/env";
import { type OAuthProvider, PrismaClient } from "@/generated/prisma/client";
import { AuthService } from "./auth.service";
import { canUnlink, resolveOAuthLogin } from "./oauth-login";
import {
  dbProvider,
  type OAuthProfile,
  type OAuthProviderConfig,
  signInProviders,
} from "./oauth-providers";
import { revokeRefreshTokens } from "./revoke-refresh-tokens";

/** Google/GitHub sign-in. Identity only: no provider tokens stored, `wrappedDek` untouched. */
@singleton()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly authService: AuthService,
  ) {}

  private getConfig(provider: OAuthProviderInput): OAuthProviderConfig {
    const [clientId, clientSecret] =
      provider === "google"
        ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
        : [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET];
    if (!clientId || !clientSecret) {
      // Slug, not prose: the web maps it to friendly copy on the login page.
      throw new Error("provider_not_configured" satisfies OAuthErrorReason);
    }
    return {
      clientId,
      clientSecret,
      redirectUri: `${env.AUTH_OAUTH_REDIRECT_BASE.replace(/\/$/, "")}/api/auth/providers/${provider}/callback`,
    };
  }

  getAuthorizeUrl(provider: OAuthProviderInput, state: string): string {
    return signInProviders[provider].getAuthorizeUrl(this.getConfig(provider), state);
  }

  private linkAccount(userId: string, provider: OAuthProvider, profile: OAuthProfile) {
    return this.prisma.oAuthAccount.create({
      data: {
        userId,
        provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
      },
    });
  }

  /** Complete a sign-in callback: known identity, auto-link, or fresh signup. */
  async handleLogin(providerName: OAuthProviderInput, code: string) {
    const profile = await signInProviders[providerName].exchangeCode(
      this.getConfig(providerName),
      code,
    );
    const provider = dbProvider(providerName);

    const account = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
      },
    });
    const emailOwner = account
      ? null
      : await this.prisma.user.findUnique({
          where: { email: profile.email },
          select: { id: true, emailVerified: true },
        });
    const decision = resolveOAuthLogin(profile, account?.userId ?? null, emailOwner);

    switch (decision.action) {
      case "signin": {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: decision.userId } });
        return this.authService.issueSession(user);
      }
      case "autolink": {
        if (!decision.markVerified) {
          const [, user] = await this.prisma.$transaction([
            this.linkAccount(decision.userId, provider, profile),
            this.prisma.user.findUniqueOrThrow({ where: { id: decision.userId } }),
          ]);
          return this.authService.issueSession(user);
        }

        // Drop the pending account's unverified password (set by whoever registered the email,
        // not the now-proven mailbox owner) and revoke its sessions - else a pre-registrant keeps
        // access (account pre-hijacking). The owner can set a new password from account security.
        const [, , user] = await this.prisma.$transaction([
          this.linkAccount(decision.userId, provider, profile),
          revokeRefreshTokens(this.prisma, decision.userId),
          this.prisma.user.update({
            where: { id: decision.userId },
            data: { emailVerified: true, passwordHash: null },
          }),
        ]);
        return this.authService.issueSession(user);
      }
      case "signup": {
        // Provider-verified email: skip the verification round-trip entirely.
        const user = await this.authService.createUserAccount({
          email: profile.email,
          passwordHash: null,
          emailVerified: true,
        });
        await this.linkAccount(user.id, provider, profile);
        return this.authService.issueSession(user);
      }
      case "reject":
        throw new Error(decision.reason);
    }
  }

  /** Explicitly link a provider identity to the signed-in account; no email match needed. */
  async link(userId: string, providerName: OAuthProviderInput, code: string): Promise<void> {
    const profile = await signInProviders[providerName].exchangeCode(
      this.getConfig(providerName),
      code,
    );
    const provider = dbProvider(providerName);

    const [existing, mine] = await Promise.all([
      this.prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
        },
      }),
      this.prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId, provider } },
      }),
    ]);
    if (existing) {
      if (existing.userId === userId) {
        return; // Already linked here - idempotent success.
      }
      throw new Error("This account is already linked to another OpenApply user");
    }
    if (mine) {
      throw new Error(`A ${providerName} account is already linked - unlink it first`);
    }
    await this.linkAccount(userId, provider, profile);
  }

  async unlink(userId: string, providerName: OAuthProviderInput): Promise<{ ok: true }> {
    const provider = dbProvider(providerName);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, oauthAccounts: { select: { provider: true } } },
    });
    if (!user?.oauthAccounts.some((a) => a.provider === provider)) {
      throw notFound("Provider not linked");
    }
    if (!canUnlink(user.passwordHash !== null, user.oauthAccounts.length)) {
      throw conflict(
        "Set a password or link another provider before removing your last sign-in method",
      );
    }
    await this.prisma.oAuthAccount.delete({ where: { userId_provider: { userId, provider } } });
    return { ok: true };
  }
}
