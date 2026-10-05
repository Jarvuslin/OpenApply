import { EnvSchema } from "./env.schema";
import { describe, expect, it } from "bun:test";

const local = {
  DATABASE_URL: "postgresql://test:test@localhost:5433/test",
  JWT_SECRET: "local-test",
  SECRET_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
};
const production = {
  ...local,
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(48),
  APP_URL: "https://openapply.example",
  AUTH_OAUTH_REDIRECT_BASE: "https://openapply.example",
  RESEND_API_KEY: "test-key",
  EMAIL_FROM: "OpenApply <accounts@openapply.example>",
};

describe("auth environment validation", () => {
  it("keeps email/password usable locally without provider keys", () => {
    const parsed = EnvSchema.parse({ ...local, GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "" });
    expect(parsed.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(parsed.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });
  it("rejects half-configured OAuth clients", () => {
    expect(EnvSchema.safeParse({ ...local, GOOGLE_CLIENT_ID: "id" }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...local, GITHUB_CLIENT_SECRET: "secret" }).success).toBe(false);
  });
  it("normalizes callback origins and rejects paths and embedded credentials", () => {
    expect(
      EnvSchema.parse({ ...local, AUTH_OAUTH_REDIRECT_BASE: "http://localhost:4101/" })
        .AUTH_OAUTH_REDIRECT_BASE,
    ).toBe("http://localhost:4101");
    for (const url of [
      "not-a-url",
      "https://example.com/api",
      "https://user:pass@example.com",
      "https://example.com?redirect=1",
    ]) {
      expect(EnvSchema.safeParse({ ...local, AUTH_OAUTH_REDIRECT_BASE: url }).success).toBe(false);
    }
  });
  it("requires real email delivery and strong secrets for production", () => {
    expect(EnvSchema.safeParse(production).success).toBe(true);
    expect(EnvSchema.safeParse({ ...production, SUPER_ADMIN_EMAIL: "" }).success).toBe(true);
    for (const override of [
      { RESEND_API_KEY: "" },
      { EMAIL_FROM: "onboarding@resend.dev" },
      { JWT_SECRET: "change-me" },
    ]) {
      expect(EnvSchema.safeParse({ ...production, ...override }).success).toBe(false);
    }
  });
  it("rejects insecure or split-origin production cookie deployments", () => {
    expect(
      EnvSchema.safeParse({ ...production, APP_URL: "http://openapply.example" }).success,
    ).toBe(false);
    expect(
      EnvSchema.safeParse({
        ...production,
        AUTH_OAUTH_REDIRECT_BASE: "https://api.openapply.example",
      }).success,
    ).toBe(false);
  });
});
