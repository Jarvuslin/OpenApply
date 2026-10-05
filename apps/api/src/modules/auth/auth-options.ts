interface AuthSettings {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  NODE_ENV: string;
  AUTH_REQUIRE_EMAIL_VERIFICATION?: boolean;
}

/** Public capabilities only. Never spread environment variables into a response. */
export function authOptions(settings: AuthSettings) {
  return {
    providers: {
      google: Boolean(settings.GOOGLE_CLIENT_ID?.trim() && settings.GOOGLE_CLIENT_SECRET?.trim()),
      github: Boolean(settings.GITHUB_CLIENT_ID?.trim() && settings.GITHUB_CLIENT_SECRET?.trim()),
    },
    emailPassword: true,
    emailDelivery: settings.RESEND_API_KEY?.trim() ? ("email" as const) : ("console" as const),
    emailVerificationRequired:
      settings.NODE_ENV !== "development" || settings.AUTH_REQUIRE_EMAIL_VERIFICATION === true,
  };
}
