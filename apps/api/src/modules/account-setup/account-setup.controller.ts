import {
  accountSetupBeginSchema,
  accountSetupContextSchema,
  accountSetupContinueSchema,
  accountSetupCredentialSchema,
  accountSetupObserveSchema,
  accountSetupSaveCredentialsSchema,
  accountSetupSnapshotSchema,
  enqueueAccountSetupSchema,
} from "@openapply/contracts/account-setup";
import { idParam } from "@openapply/contracts/shared";
import { workItemSchema } from "@openapply/contracts/work-queue";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { AccountSetupService } from "./account-setup.service";

const service = container.resolve(AccountSetupService);
const runtime = rateLimit(RATE_LIMITS.workQueueRuntime);

// Capability routes must be registered before the normal account authentication guard.
export const accountSetupController = new Elysia({
  prefix: "/account-setup",
  detail: { tags: ["Account setup"] },
})
  .get("/context", ({ headers }) => service.context(headers.authorization), {
    response: accountSetupContextSchema,
    beforeHandle: runtime,
    detail: { summary: "Read only this live account setup snapshot and attempt state" },
  })
  .get(
    "/credential",
    ({ headers, set }) => {
      set.headers["Cache-Control"] = "no-store";
      return service.credential(headers.authorization);
    },
    {
      response: accountSetupCredentialSchema,
      beforeHandle: runtime,
      detail: {
        summary: "Read the exact encrypted credential through the internal account broker",
      },
    },
  )
  .post("/begin", ({ headers }) => service.begin(headers.authorization), {
    body: accountSetupBeginSchema,
    response: accountSetupContextSchema,
    beforeHandle: runtime,
    detail: { summary: "Consume the single durable signup attempt before browser mutation" },
  })
  .post("/observe", ({ headers, body }) => service.observe(headers.authorization, body), {
    body: accountSetupObserveSchema,
    response: accountSetupContextSchema,
    beforeHandle: runtime,
    detail: { summary: "Record exact account browser evidence and resumable operational handoffs" },
  })
  .use(authGuard)
  .post("/", ({ user, authKind, body }) => service.enqueue(user.id, body, authKind), {
    body: enqueueAccountSetupSchema,
    response: z.object({ item: workItemSchema, snapshot: accountSetupSnapshotSchema }),
    beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
    detail: { summary: "Queue exactly one employer account setup with an owned credential" },
  })
  .get("/:id", ({ user, params }) => service.detail(user.id, params.id), {
    params: idParam,
    response: z.object({ item: workItemSchema, context: accountSetupContextSchema }),
    beforeHandle: runtime,
    detail: { summary: "Read an owned account setup and its durable evidence" },
  })
  .post(
    "/:id/continue",
    ({ user, authKind, params, body }) => service.continue(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: accountSetupContinueSchema,
      response: z.object({ item: workItemSchema, context: accountSetupContextSchema }),
      beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
      detail: { summary: "Save a human account decision without launching model work" },
    },
  )
  .post(
    "/:id/credentials",
    ({ user, authKind, params, body }) =>
      service.saveCredentials(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: accountSetupSaveCredentialsSchema,
      response: z.object({ item: workItemSchema, context: accountSetupContextSchema }),
      beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
      detail: {
        summary: "Securely save an existing employer password and prepare a fresh inspection grant",
      },
    },
  )
  .get("/:id/snapshot", ({ user, params }) => service.plan(user.id, params.id), {
    params: idParam,
    response: accountSetupSnapshotSchema,
    beforeHandle: runtime,
    detail: { summary: "Read an unspent account setup snapshot for its local budget grant" },
  });
