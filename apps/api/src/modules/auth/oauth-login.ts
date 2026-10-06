import type { OAuthErrorReason } from "@openapply/contracts";
import type { OAuthProfile } from "./oauth-providers";

export type OAuthLoginDecision =
  | { action: "signin"; userId: string }
  | { action: "autolink"; userId: string; markVerified: boolean }
  | { action: "signup" }
  | { action: "reject"; reason: Extract<OAuthErrorReason, "email_unverified"> };

/** Known identities sign in as-is; everything else requires a provider-verified email. */
export function resolveOAuthLogin(
  profile: OAuthProfile,
  existingAccountUserId: string | null,
  emailOwner: { id: string; emailVerified: boolean } | null,
): OAuthLoginDecision {
  if (existingAccountUserId) {
    return { action: "signin", userId: existingAccountUserId };
  }
  if (!profile.emailVerified) {
    return { action: "reject", reason: "email_unverified" };
  }
  if (emailOwner) {
    // Provider proved mailbox control, so a still-pending account gets verified too.
    return { action: "autolink", userId: emailOwner.id, markVerified: !emailOwner.emailVerified };
  }
  return { action: "signup" };
}

/** Never allow removing the last way into the account. */
export function canUnlink(hasPassword: boolean, providerCount: number): boolean {
  return hasPassword || providerCount > 1;
}
