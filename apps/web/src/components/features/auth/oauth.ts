import type { OAuthErrorReason, OAuthProviderInput } from "@jobpilot/contracts/auth";
import { API_BASE_URL } from "@/api/base-url";

/** The sign-in providers the API supports, in display order. */
export const OAUTH_PROVIDERS: ReadonlyArray<{ id: OAuthProviderInput; label: string }> = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

/** API endpoint that starts the OAuth redirect flow (assign to window.location.href). */
export function oauthStartUrl(provider: OAuthProviderInput, intent?: "link"): string {
  const base = `${API_BASE_URL}/api/auth/providers/${provider}/authorize`;
  return intent ? `${base}?intent=${intent}` : base;
}

/** Copy for every contract slug (Record over the union so a new slug fails the build);
 *  unknown reasons are provider prose and pass through as-is. */
const REASON_COPY: Record<OAuthErrorReason, string> = {
  provider_not_configured:
    "This sign-in provider isn't set up on this server. Sign in with email and password, or create an account.",
  email_unverified:
    "Your email isn't verified with that provider, so it can't be used to sign in here.",
  access_denied: "Sign-in was cancelled.",
};

export function resolveOauthReason(reason: string | undefined | null): string | null {
  if (!reason) {
    return null;
  }
  return (REASON_COPY as Record<string, string>)[reason] ?? reason;
}
