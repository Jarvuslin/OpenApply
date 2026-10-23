import { z } from "zod/v4";

export const discoverCoverageSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["connected", "needs_setup", "unavailable", "error", "pending"]),
      details: z.string(),
      lastSuccessAt: z.date().nullable(),
      nextRefreshAt: z.date().nullable(),
    }),
  ),
  refreshing: z.boolean(),
  lastUpdatedAt: z.date().nullable(),
});

export const discoverRefreshSchema = discoverCoverageSchema.extend({ scheduled: z.boolean() });

export const discoverSearchInputSchema = z.object({
  provider: z.enum(["apify", "serpapi", "hiringcafe"]),
  query: z.string().trim().min(2).max(200),
  location: z.string().trim().max(200).default(""),
  board: z.enum(["indeed", "linkedin", "glassdoor", "hiringcafe", "ycombinator"]).optional(),
  limit: z.number().int().min(1).max(25).default(20),
});

export const discoverSearchResultSchema = z.object({
  imported: z.number().int().min(0),
  fetched: z.number().int().min(0),
  cached: z.boolean(),
  hasMore: z.boolean(),
  message: z.string(),
  jobs: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        location: z.string(),
        description: z.string(),
        postedAt: z.date().nullable(),
        url: z.url(),
      }),
    )
    .optional(),
});
