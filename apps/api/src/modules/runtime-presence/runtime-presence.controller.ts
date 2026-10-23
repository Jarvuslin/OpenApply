import {
  runtimeHeartbeatSchema,
  runtimePresenceSchema,
} from "@openapply/contracts/runtime-presence";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { RuntimePresenceService } from "./runtime-presence.service";

const service = container.resolve(RuntimePresenceService);
export const runtimePresenceController = new Elysia({ prefix: "/runtime/presence" })
  .use(authGuard)
  .get("/", ({ user }) => service.read(user.id), {
    response: runtimePresenceSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "Read local runtime presence without probing a provider" },
  })
  .post("/", ({ user, body, authKind }) => service.heartbeat(user.id, body, authKind), {
    body: runtimeHeartbeatSchema,
    response: runtimePresenceSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRuntime),
    detail: { summary: "Record a server-timed local runtime heartbeat" },
  });
