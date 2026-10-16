import {
  discoverCoverageSchema,
  discoverRefreshSchema,
  discoverSearchInputSchema,
  discoverSearchResultSchema,
} from "@openapply/contracts/discover-feed";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { env } from "@/env";
import { DiscoveryFeedService } from "./discovery-feed.service";
import { DiscoverySearchService } from "./discovery-search.service";

const service = container.resolve(DiscoveryFeedService);
const search = container.resolve(DiscoverySearchService);
export const discoveryFeedController = new Elysia({
  prefix: "/job-sources",
  detail: { tags: ["Discovery"] },
})
  .use(authGuard)
  .get("/coverage", ({ user }) => service.coverage(user.id), {
    response: discoverCoverageSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Show actual feed coverage, connector setup and source freshness" },
  })
  .post("/refresh", ({ user }) => service.requestRefresh(user.id, env.JOB_FEED_REFRESH_ENABLED), {
    response: discoverRefreshSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRefresh),
    detail: { summary: "Request a background refresh of due shared feeds" },
  })
  .post("/search", ({ user, body }) => search.search(user.id, body), {
    body: discoverSearchInputSchema,
    response: discoverSearchResultSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverSearch),
    detail: { summary: "Explicitly search one provider with bounded cached batches" },
  });
