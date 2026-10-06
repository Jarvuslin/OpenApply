import { normalizeEmail } from "@/common/utils/email";
import type { OAuthProfile, OAuthProviderConfig, SignInProvider } from "./sign-in-provider";

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Primary+verified wins, then any verified; unverified addresses are never trusted. */
export function pickGithubEmail(emails: GithubEmail[]): string | null {
  const primary = emails.find((e) => e.primary && e.verified);
  if (primary) {
    return primary.email;
  }
  return emails.find((e) => e.verified)?.email ?? null;
}

export class GithubSignInProvider implements SignInProvider {
  getAuthorizeUrl(config: OAuthProviderConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: "user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(config: OAuthProviderConfig, code: string): Promise<OAuthProfile> {
    const accessToken = await this.exchangeToken(config, code);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      // GitHub's API rejects requests without a User-Agent.
      "User-Agent": "OpenApply",
    };

    const userRes = await fetch("https://api.github.com/user", { headers });
    if (!userRes.ok) {
      throw new Error("Failed to load the GitHub profile");
    }
    const ghUser = (await userRes.json()) as { id?: number };
    if (!ghUser.id) {
      throw new Error("Could not resolve the GitHub account");
    }

    // `/user.email` is often null; the emails endpoint carries the verified flags.
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    const emails = emailsRes.ok ? ((await emailsRes.json()) as GithubEmail[]) : [];
    const email = pickGithubEmail(emails);
    if (!email) {
      throw new Error("No verified email on the GitHub account");
    }
    return {
      providerAccountId: String(ghUser.id),
      email: normalizeEmail(email),
      emailVerified: true,
    };
  }

  private async exchangeToken(config: OAuthProviderConfig, code: string): Promise<string> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string };
    if (!body.access_token) {
      throw new Error(body.error_description ?? "GitHub did not return an access token");
    }
    return body.access_token;
  }
}
