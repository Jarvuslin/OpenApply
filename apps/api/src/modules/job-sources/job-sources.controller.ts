import {
  applyDiscoverySchema,
  boardInputSchema,
  completeDiscoverySchema,
  discoverInputSchema,
  discoveryConnectionSchema,
  discoveryProviderSchema,
  discoveryResultSchema,
  initializeDiscoverySchema,
  profileDiscoveryInputSchema,
  profileDiscoverySchema,
} from "@openapply/contracts/job-sources";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { JobSourcesService } from "./job-sources.service";
import { ProfileDiscoveryService } from "./profile-discovery.service";

const service = container.resolve(JobSourcesService);
const lists = container.resolve(ProfileDiscoveryService);
export const jobSourcesController = new Elysia({
  prefix: "/job-sources",
  detail: { tags: ["Discovery"] },
})
  .use(authGuard)
  .post("/profile-list", ({ user, body }) => lists.create(user.id, body), {
    body: profileDiscoveryInputSchema,
    response: profileDiscoverySchema,
    beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
    detail: { summary: "Create a profile-driven candidate list using an explicit original resume" },
  })
  .post(
    "/profile-list/:id/complete",
    ({ user, params, body }) => lists.complete(user.id, params.id, body.reason),
    {
      params: idParam,
      body: completeDiscoverySchema,
      response: profileDiscoverySchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: {
        summary: "Finish bounded discovery after every resolved candidate has a current score",
      },
    },
  )
  .post(
    "/profile-list/:id/initialize",
    ({ user, params, body }) => lists.initialize(user.id, params.id, body),
    {
      params: idParam,
      body: initializeDiscoverySchema,
      response: profileDiscoverySchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: {
        summary:
          "Initialize list-first discovery on an empty campaign without changing its selected resume",
      },
    },
  )
  .post(
    "/profile-list/:id/apply",
    ({ user, params, body }) => lists.apply(user.id, params.id, body.maxApplications),
    {
      params: idParam,
      body: applyDiscoverySchema,
      response: profileDiscoverySchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: { summary: "Authorize applications from an existing completed candidate list" },
    },
  )
  .get("/connections", ({ user }) => service.connections(user.id), {
    response: z.array(
      discoveryConnectionSchema
        .omit({ apiKey: true })
        .extend({ provider: z.string(), configured: z.boolean() }),
    ),
    detail: { summary: "List discovery connections without secrets" },
  })
  .put(
    "/connections/:provider",
    ({ user, params, body }) => service.configure(user.id, params.provider, body),
    {
      params: z.object({ provider: discoveryProviderSchema }),
      body: discoveryConnectionSchema,
      response: z.object({
        provider: discoveryProviderSchema,
        enabled: z.boolean(),
        configured: z.boolean(),
      }),
      detail: { summary: "Opt in to a discovery connector" },
    },
  )
  .post("/discover", ({ user, body }) => service.discover(user.id, body), {
    body: discoverInputSchema,
    response: discoveryResultSchema,
    detail: { summary: "Find jobs using an enabled HTTP connector" },
  })
  .post(
    "/boards",
    ({ user, body }) =>
      service.publicBoard(
        body.provider,
        body.slug,
        body.campaignId ? { userId: user.id, campaignId: body.campaignId } : undefined,
      ),
    {
      body: boardInputSchema,
      response: discoveryResultSchema,
      detail: { summary: "Import a public employer ATS board" },
    },
  );
