import { z } from "zod/v4";

const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined);
const origin = z
  .url()
  .refine((v) => {
    const url = URL.parse(v);
    return (
      url !== null &&
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, "must be an HTTP(S) origin without a path, query, or credentials")
  .transform((v) => v.replace(/\/$/, ""));

/**
 * Backend environment contract. Bun loads apps/api/.env when started in that directory.
 * env.ts validates this schema once at startup; this module has no environment side effects.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(4101),
    CAPTCHA_SOLVER_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    PUBLIC_SITE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    MVP_LOCAL_RUNNER: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    CLAUDE_BIN: z.string().default("claude"),

    DATABASE_URL: z.string().min(1),

    JWT_SECRET: z.string().min(1),
    JWT_EXPIRY: z.string().default("1d"),
    REFRESH_TOKEN_EXPIRY: z.string().default("30d"),
    AUTH_REQUIRE_EMAIL_VERIFICATION: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    // Master key wrapping per-user DEKs (`openssl rand -base64 32`); rotating it re-wraps DEKs, not the data.
    SECRET_MASTER_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of 32 bytes"),

    // The one account that can grant/revoke ADMIN. Granted at register + reconciled by `db:seed`;
    // no API route assigns it. Unset = nobody holds the role.
    SUPER_ADMIN_EMAIL: z.preprocess(
      (v) => (typeof v === "string" && !v.trim() ? undefined : v),
      z.email().optional(),
    ),

    // CSV of allowed browser origins for CORS (credentials mode - no wildcard).
    CORS_ORIGINS: z.string().default("http://localhost:4100"),
    // Public web origin, used for OAuth redirects back to the app.
    APP_URL: origin.default("http://localhost:4100"),

    // Filesystem root for resumes / generated PDFs.
    STORAGE_ROOT: z.string().default("./storage"),

    LOG_LEVEL: z.string().default("info"),

    // Google OAuth (Gmail) callback URL. Client id/secret are per-user (entered in the
    // app); only this shared callback is configured here - users register it in their own client.
    GOOGLE_OAUTH_REDIRECT_URI: z.string().default("http://localhost:4101/api/email/oauth/callback"),

    // Google/GitHub sign-in clients (distinct from the per-user Gmail client); unset = disabled.
    GOOGLE_CLIENT_ID: optionalSecret,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    GITHUB_CLIENT_ID: optionalSecret,
    GITHUB_CLIENT_SECRET: optionalSecret,
    // Public API origin for sign-in callbacks: `${base}/api/auth/providers/{provider}/callback`.
    AUTH_OAUTH_REDIRECT_BASE: origin.default("http://localhost:4101"),

    // Transactional email (Resend). Optional: when unset, the app logs the email
    // body (incl. magic links) instead of sending in local development only.
    RESEND_API_KEY: optionalSecret,
    // Sender of account emails. `onboarding@resend.dev` is Resend's no-domain test
    // sender (only delivers to the Resend account owner); production needs a verified domain.
    EMAIL_FROM: z.string().default("OpenApply <onboarding@resend.dev>"),

    // Web Push (VAPID). All three optional: unset silently disables push (never crashes startup).
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z
      .string()
      .refine(
        (v) => v.startsWith("mailto:") || v.startsWith("https://"),
        "must be a mailto: or https:// URL",
      )
      .optional(),
  })
  .superRefine((settings, ctx) => {
    for (const provider of ["GOOGLE", "GITHUB"] as const) {
      const id = settings[`${provider}_CLIENT_ID`];
      const secret = settings[`${provider}_CLIENT_SECRET`];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: "custom",
          path: [`${provider}_CLIENT_ID`],
          message: `set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET, or leave both empty`,
        });
      }
    }
    if (settings.NODE_ENV !== "production") return;
    if (!settings.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "required in production; account emails must not fall back to server logs",
      });
    }
    if (settings.EMAIL_FROM.toLowerCase().includes("@resend.dev")) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "use a sender on your verified domain in production",
      });
    }
    if (settings.JWT_SECRET.length < 32 || /change-me|dev-insecure/.test(settings.JWT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "use a unique random secret of at least 32 characters in production",
      });
    }
    if (!settings.APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "HTTPS is required for production session cookies",
      });
    }
    // Next's server-side route guard needs the same host-only cookie as the API.
    if (settings.AUTH_OAUTH_REDIRECT_BASE !== settings.APP_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_OAUTH_REDIRECT_BASE"],
        message: "production web and API must share one public origin; proxy /api to the backend",
      });
    }
  });
