import {
  atsProviderSchema,
  discoverInputSchema,
  discoveryConnectionSchema,
  discoveryProviderSchema,
} from "@openapply/contracts/job-sources";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { JobSourcesService } from "./job-sources.service";

const service = container.resolve(JobSourcesService);
const result = z.object({ imported: z.number(), fetched: z.number(), resolved: z.number() });
export const jobSourcesController = new Elysia({
  prefix: "/job-sources",
  detail: { tags: ["Discovery"] },
})
  .use(authGuard)
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
    response: result,
    detail: { summary: "Find jobs using an enabled HTTP connector" },
  })
  .post("/boards", ({ body }) => service.publicBoard(body.provider, body.slug), {
    body: z.object({
      provider: atsProviderSchema,
      slug: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/),
    }),
    response: result,
    detail: { summary: "Import a public employer ATS board" },
  });
