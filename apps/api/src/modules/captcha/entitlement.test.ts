import { Elysia } from "elysia";
import { signAccessToken } from "@/common/auth/tokens";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { env } from "@/env";
import { httpErrorResponses } from "@/types/response";
import { captchaController } from "./captcha.controller";
import { canUseCaptchaSolver } from "./entitlement";
import { describe, expect, it } from "bun:test";

const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .use(captchaController);
describe("CAPTCHA entitlement", () => {
  it("blocks solving before a provider can be called and exposes status", async () => {
    const previous = env.CAPTCHA_SOLVER_ENABLED;
    env.CAPTCHA_SOLVER_ENABLED = false;
    try {
      const token = await signAccessToken({
        id: crypto.randomUUID(),
        role: "USER",
        email: "test@example.com",
      });
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const status = await app.handle(new Request("http://localhost/captcha/status", { headers }));
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ entitled: false });
      const solve = await app.handle(
        new Request("http://localhost/captcha/solve", {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "recaptcha",
            sitekey: "test-key",
            pageurl: "https://employer.example/apply",
          }),
        }),
      );
      expect(solve.status).toBe(403);
      expect(await solve.json()).toMatchObject({ code: "FORBIDDEN" });
      env.CAPTCHA_SOLVER_ENABLED = true;
      expect(canUseCaptchaSolver({ id: "test" })).toBe(true);
    } finally {
      env.CAPTCHA_SOLVER_ENABLED = previous;
    }
  });
  it("requires authentication for status", async () => {
    expect((await app.handle(new Request("http://localhost/captcha/status"))).status).toBe(401);
  });
});
