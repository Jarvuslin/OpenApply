import { authOptions } from "./auth-options";
import { describe, expect, it } from "bun:test";

describe("public sign-in options", () => {
  it("disables unconfigured and partial providers and never exposes credentials", () => {
    expect(
      authOptions({
        NODE_ENV: "development",
        GOOGLE_CLIENT_ID: "id-only",
        GITHUB_CLIENT_ID: "github-id",
        GITHUB_CLIENT_SECRET: "private-value",
        RESEND_API_KEY: "private-mail-key",
      }),
    ).toEqual({
      providers: { google: false, github: true },
      emailPassword: true,
      emailDelivery: "email",
      emailVerificationRequired: false,
    });
  });

  it("supports local verification testing without disabling verification in production", () => {
    expect(
      authOptions({ NODE_ENV: "development", AUTH_REQUIRE_EMAIL_VERIFICATION: true })
        .emailVerificationRequired,
    ).toBe(true);
    expect(
      authOptions({ NODE_ENV: "production", AUTH_REQUIRE_EMAIL_VERIFICATION: false })
        .emailVerificationRequired,
    ).toBe(true);
    expect(authOptions({ NODE_ENV: "development", RESEND_API_KEY: " " }).emailDelivery).toBe(
      "console",
    );
  });
});
