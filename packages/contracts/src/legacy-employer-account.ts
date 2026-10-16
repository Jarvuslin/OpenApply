export const LEGACY_EMPLOYER_ACCOUNT_MODES = ["account_only", "apply"] as const;
export const LEGACY_EMPLOYER_ACCOUNT_STATES = [
  "checking",
  "signup_ready",
  "signup_started",
  "verification_pending",
  "needs_user",
  "authenticated",
  "unknown",
  "skipped",
] as const;
export const LEGACY_EMPLOYER_ACCOUNT_REASONS = [
  "existing_account_credentials",
  "password_entry",
  "terms_confirmation",
  "mailbox_identity",
  "verification",
  "captcha",
] as const;
