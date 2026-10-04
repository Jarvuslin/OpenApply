import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { notFound } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { env } from "@/env";
import {
  observationResult,
  readinessResult,
  sourceInput,
  sourceResult,
  startInput,
  startResult,
} from "./mvp.schema";
import { MvpService } from "./mvp.service";

const service = container.resolve(MvpService);
export const mvpController = new Elysia({ prefix: "/mvp", detail: { tags: ["MVP"] } })
  .use(authGuard)
  .onBeforeHandle(() => {
    if (!env.MVP_LOCAL_RUNNER) throw notFound("Local MVP is disabled");
  })
  .get("/readiness", ({ user }) => service.readiness(user.id), {
    response: readinessResult,
    detail: { summary: "Check profile, Gmail and VM browser readiness" },
  })
  .post("/sources", ({ user, body }) => service.refresh(user.id, body), {
    body: sourceInput,
    response: sourceResult,
    detail: { summary: "Import public listings from an Ashby or Greenhouse board" },
  })
  .post("/apply", ({ user, body }) => service.start(user.id, body.slug), {
    body: startInput,
    response: startResult,
    detail: { summary: "Approve and queue exactly one selected job" },
  })
  .post("/observe", ({ user }) => service.observe(user.id), {
    response: observationResult.array(),
    detail: { summary: "Record challenge indicators in the VM browser without solving them" },
  });
