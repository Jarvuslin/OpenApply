import { captchaSolveSchema } from "@jobpilot/contracts/captcha";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { badRequest } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { env } from "@/env";
import { captchaSolveResultSchema } from "./captcha.schema";
import { CaptchaService } from "./captcha.service";

const svc = container.resolve(CaptchaService);

// Runs after authGuard's derive, so `user` is in context - the policy is user-keyed.
const limitSolve = rateLimit(RATE_LIMITS.captchaSolve);

export const captchaController = new Elysia({
  prefix: "/captcha",
  detail: { tags: ["Captcha"] },
})
  .use(authGuard)
  .post(
    "/solve",
    ({ user, body }) => {
      if (env.MVP_LOCAL_RUNNER)
        throw badRequest(
          "CAPTCHA solving is on hold for this MVP. Continue manually in the VM browser.",
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
