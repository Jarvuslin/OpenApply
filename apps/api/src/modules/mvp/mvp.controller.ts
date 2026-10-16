import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { readinessResult, sourceInput, sourceResult, startInput, startResult } from "./mvp.schema";
import { MvpService } from "./mvp.service";

const service = container.resolve(MvpService);
export const mvpController = new Elysia({ prefix: "/mvp", detail: { tags: ["MVP"] } })
  .use(authGuard)
  .get("/readiness", ({ user }) => service.readiness(user.id), {
    response: readinessResult,
    detail: { summary: "Check profile, Gmail and VM browser readiness" },
  })
  .post("/sources", ({ user, body }) => service.refresh(user.id, body), {
    body: sourceInput,
    response: sourceResult,
    detail: { summary: "Import public listings from an employer ATS board" },
  })
  .post(
    "/apply",
    ({ user, body }) => service.start(user.id, body.slugs, body.idempotencyKey, body.provider),
    {
      body: startInput,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      response: startResult,
      detail: { summary: "Queue selected jobs in the standing apply campaign" },
    },
  );
