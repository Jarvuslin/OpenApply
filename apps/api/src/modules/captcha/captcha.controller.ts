import { captchaSolveSchema } from "@jobpilot/contracts/captcha";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { forbidden } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { captchaSolveResultSchema } from "./captcha.schema";
import { CaptchaService } from "./captcha.service";
import { canUseCaptchaSolver } from "./entitlement";

const svc = container.resolve(CaptchaService);

// Runs after authGuard's derive, so `user` is in context - the policy is user-keyed.
const limitSolve = rateLimit(RATE_LIMITS.captchaSolve);

export const captchaController = new Elysia({
  prefix: "/captcha",
  detail: { tags: ["Captcha"] },
})
  .use(authGuard)
  .get("/status", ({ user }) => ({ entitled: canUseCaptchaSolver(user) }), {
    response: z.object({ entitled: z.boolean() }),
    detail: { summary: "Check CAPTCHA solver entitlement" },
  })
  .post(
    "/solve",
    ({ user, body }) => {
      if (!canUseCaptchaSolver(user))
        throw forbidden(
          "CAPTCHA solving is not enabled for your account. Complete verification in the open browser tab.",
        );
      return svc.solve(user.id, body);
    },
    {
      body: captchaSolveSchema,
      beforeHandle: limitSolve,
      response: captchaSolveResultSchema,
      detail: {
        summary: "Solve a CAPTCHA",
        description:
          "Solves the supplied CAPTCHA challenge through the active profile's configured third-party solver (2captcha or CapSolver) and returns the resolved token along with the provider that solved it.",
      },
    },
  );
