import { Elysia } from "elysia";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { env } from "@/env";
import { httpErrorResponses } from "@/types/response";
import { jobListingController, publicJobListingController } from "./job-listing.controller";
import { describe, expect, it } from "bun:test";

const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(publicJobListingController).use(jobListingController));

describe("public job site gate", () => {
  it("returns 404 for every public route while disabled", async () => {
    const previous = env.PUBLIC_SITE_ENABLED;
    env.PUBLIC_SITE_ENABLED = false;
    try {
      for (const path of ["/", "/facets", "/sitemap", "/example"]) {
        const response = await app.handle(new Request(`http://localhost/api/public/jobs${path}`));
        expect(response.status).toBe(404);
      }
    } finally {
      env.PUBLIC_SITE_ENABLED = previous;
    }
  });
  it("requires authentication for Discover", async () => {
    const response = await app.handle(new Request("http://localhost/api/jobs/"));
    expect(response.status).toBe(401);
  });
});
