import {
  jobLoginSchema,
  revealedPasswordSchema,
  saveJobLoginSchema,
} from "@openapply/contracts/credential";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { resolvedCredentialSchema } from "./credential.schema";
import { CredentialService } from "./credential.service";

const svc = container.resolve(CredentialService);

export const credentialController = new Elysia({
  prefix: "/credentials",
  detail: { tags: ["Credentials"] },
})
  .use(authGuard)
  .get("/login", ({ user, authKind }) => svc.login(user.id, authKind), {
    response: jobLoginSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "Read the job login without its password or captcha key" },
  })
  .put("/login", ({ user, authKind, body }) => svc.saveLogin(user.id, authKind, body), {
    body: saveJobLoginSchema,
    response: jobLoginSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
    detail: { summary: "Replace the job login used on every employer site" },
  })
  .post("/login/reveal", ({ user, authKind }) => svc.revealPassword(user.id, authKind), {
    response: revealedPasswordSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
    detail: { summary: "Show the saved job-login password to its signed-in owner" },
  })
  .get("/resolve", ({ user }) => svc.resolveCredential(user.id), {
    response: resolvedCredentialSchema,
    detail: {
      summary: "Resolve the job login",
      description:
        "Returns the one email/password used on every employer site with its credential id, or null when none is saved.",
    },
  });
