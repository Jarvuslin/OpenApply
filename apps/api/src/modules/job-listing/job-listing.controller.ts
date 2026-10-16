import {
  jobListingQuerySchema,
  jobListingUpdatesQuerySchema,
  jobListingUpdatesSchema,
} from "@openapply/contracts/job-listing";
import { paginationQuerySchema } from "@openapply/contracts/pagination";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { notFound } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { env } from "@/env";
import {
  appliedJobListingResultSchema,
  discoverJobListingPageSchema,
  discoverJobListingSchema,
  jobListingFacetsSchema,
  jobListingPageSchema,
  jobListingSchema,
  jobListingSitemapSchema,
  savedJobListingCountSchema,
  savedJobListingPageSchema,
  savedJobListingResultSchema,
  savedJobListingSlugsSchema,
} from "./job-listing.schema";
import { JobListingService } from "./job-listing.service";

const svc = container.resolve(JobListingService);

/** Deliberately unguarded (auth is opt-in here): this backs the crawlable public /jobs pages. */
export const publicJobListingController = new Elysia({
  prefix: "/public/jobs",
  detail: { tags: ["Jobs"] },
})
  // Scoped once, so a route added later cannot forget it.
  .guard({
    beforeHandle: [
      () => {
        if (!env.PUBLIC_SITE_ENABLED) throw notFound("Public job listings are disabled.");
      },
      rateLimit(RATE_LIMITS.publicJobs),
    ],
  })
  .get("/", ({ query }) => svc.list(query), {
    query: jobListingQuerySchema,
    response: jobListingPageSchema,
    detail: {
      summary: "List public job listings",
      description:
        "Returns a page of deduped, published job listings filtered by free text, location, remote, board, and skills. Unauthenticated.",
    },
  })
  // Declared before /:slug so the literal path wins the match.
  .get("/facets", () => svc.facets(), {
    response: jobListingFacetsSchema,
    detail: {
      summary: "Job listing filter facets",
      description:
        "Returns the skills present in the published index with their listing counts, most common first. Backs the /jobs `?tech=` filter. Unauthenticated.",
    },
  })
  .get("/sitemap", () => svc.sitemap(), {
    response: jobListingSitemapSchema,
    detail: {
      summary: "Job listing sitemap feed",
      description:
        "Returns the slug and last-seen date of every published listing, capped at 5000, for the web app's sitemap.xml.",
    },
  })
  .get("/:slug", ({ params }) => svc.bySlug(params.slug), {
    params: z.object({ slug: z.string().min(1) }),
    response: jobListingSchema,
    detail: {
      summary: "Get a public job listing",
      description:
        "Returns one published listing by slug, including every board it was seen on. Unauthenticated.",
    },
  });

export const jobListingController = new Elysia({ prefix: "/jobs", detail: { tags: ["Jobs"] } })
  .use(authGuard)
  .get("/", ({ user, query }) => svc.listForUser(user.id, query), {
    query: jobListingQuerySchema,
    response: discoverJobListingPageSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Browse jobs in Discover" },
  })
  .get("/facets", () => svc.facets(), {
    response: jobListingFacetsSchema,
    detail: { summary: "Discover filter options" },
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
  })
  .get("/updates", ({ user, query }) => svc.updates(user.id, query), {
    query: jobListingUpdatesQuerySchema,
    response: jobListingUpdatesSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Count matching jobs indexed since your current browsing snapshot" },
  })
  .get("/saved", ({ user, query }) => svc.saved(user.id, query), {
    query: jobListingQuerySchema,
    response: savedJobListingPageSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "List your saved jobs" },
  })
  .get("/saved/count", ({ user }) => svc.savedCount(user.id), {
    response: savedJobListingCountSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Count your saved jobs" },
  })
  .get("/saved/slugs", ({ user, query }) => svc.savedSlugs(user.id, query), {
    query: paginationQuerySchema,
    response: savedJobListingSlugsSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Page through all your saved job slugs" },
  })
  .put("/:slug/saved", ({ user, params }) => svc.setSaved(user.id, params.slug, true), {
    params: z.object({ slug: z.string().min(1) }),
    response: savedJobListingResultSchema,
    detail: { summary: "Save a job to your application to-do list" },
    beforeHandle: rateLimit(RATE_LIMITS.discoverSave),
  })
  .put(
    "/:slug/applied",
    ({ user, params, authKind }) => svc.markApplied(user.id, params.slug, authKind),
    {
      params: z.object({ slug: z.string().min(1) }),
      response: appliedJobListingResultSchema,
      detail: { summary: "Mark a job as already applied manually" },
      beforeHandle: rateLimit(RATE_LIMITS.discoverSave),
    },
  )
  .delete(
    "/:slug/applied",
    ({ user, params, authKind }) => svc.undoApplied(user.id, params.slug, authKind),
    {
      params: z.object({ slug: z.string().min(1) }),
      response: appliedJobListingResultSchema,
      detail: {
        summary: "Undo a manual applied mark without deleting confirmed agent submissions",
      },
      beforeHandle: rateLimit(RATE_LIMITS.discoverSave),
    },
  )
  .delete("/:slug/saved", ({ user, params }) => svc.setSaved(user.id, params.slug, false), {
    params: z.object({ slug: z.string().min(1) }),
    response: savedJobListingResultSchema,
    detail: { summary: "Remove a job from your application to-do list" },
    beforeHandle: rateLimit(RATE_LIMITS.discoverSave),
  })
  .get("/:slug", ({ user, params }) => svc.bySlugForUser(user.id, params.slug), {
    params: z.object({ slug: z.string().min(1) }),
    response: discoverJobListingSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Review a discovered job" },
  });
