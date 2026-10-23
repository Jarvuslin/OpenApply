import {
  intakeCreateSchema,
  intakeDecisionSchema,
  intakeListQuerySchema,
  intakeListSchema,
  intakePrepareSchema,
  jobIntakeSchema,
} from "@openapply/contracts/job-intake";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { JobIntakeService } from "./job-intake.service";

const service = container.resolve(JobIntakeService);
export const jobIntakeController = new Elysia({ prefix: "/job-intakes" })
  .use(authGuard)
  .get("/", ({ user, query }) => service.list(user.id, query), {
    query: intakeListQuerySchema,
    response: intakeListSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "List owned prepared job links" },
  })
  .get("/:id", ({ user, params }) => service.get(user.id, params.id), {
    params: idParam,
    response: jobIntakeSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "Read an owned prepared job link" },
  })
  .post("/", ({ user, body, authKind }) => service.create(user.id, body, authKind), {
    body: intakeCreateSchema,
    response: jobIntakeSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverSearch),
    detail: { summary: "Prepare one supplied job link without authorizing application" },
  })
  .post(
    "/:id/prepare",
    ({ user, params, body, authKind }) => service.prepare(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: intakePrepareSchema,
      response: jobIntakeSchema,
      beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
      detail: { summary: "Queue exact-job preparation with an explicit provider choice" },
    },
  )
  .post(
    "/:id/decision",
    ({ user, params, body, authKind }) => service.decide(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: intakeDecisionSchema,
      response: jobIntakeSchema,
      beforeHandle: rateLimit(RATE_LIMITS.workQueueMutation),
      detail: { summary: "Confirm the decision for this exact prepared job" },
    },
  );
