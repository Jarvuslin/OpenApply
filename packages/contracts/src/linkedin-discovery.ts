import { z } from "zod/v4";

export const LINKEDIN_RUN_STATUSES = ["claimed", "processing", "completed"] as const;
const LINKEDIN_EXPERIENCE_LEVELS = ["entry", "intern"] as const;

export const linkedinIngestResultSchema = z.object({
  runId: z.uuid(),
  imported: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  filtered: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative(),
  backoffUntil: z.date().nullable(),
});

export const linkedinSearchSchema = z.strictObject({
  query: z.string().trim().min(2).max(200),
  location: z.string().trim().min(2).max(200),
  distance: z.number().int().min(1).max(100).default(25),
  experienceLevels: z.array(z.enum(LINKEDIN_EXPERIENCE_LEVELS)).min(1).max(2).default(["entry"]),
  maxYearsExperience: z.number().int().min(0).max(10).default(2),
  countries: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((value) => value.toUpperCase()),
    )
    .max(10)
    .default([]),
  remoteOnly: z.boolean().default(false),
});

export const linkedinSettingsInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    searches: z.array(linkedinSearchSchema).max(4),
  })
  .refine((value) => !value.enabled || value.searches.length > 0, {
    message: "Add at least one saved search before enabling LinkedIn discovery.",
    path: ["searches"],
  });

export const linkedinSettingsSchema = linkedinSettingsInputSchema.safeExtend({
  lastRunAt: z.date().nullable(),
  nextRunAt: z.date().nullable(),
  backoffUntil: z.date().nullable(),
  lastRunStatus: z.enum(LINKEDIN_RUN_STATUSES).nullable(),
  lastCompletedAt: z.date().nullable(),
  lastResult: linkedinIngestResultSchema.nullable(),
});

export const linkedinRunInputSchema = z.strictObject({});
export const linkedinRunSchema = z.object({
  runId: z.uuid(),
  leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
  searches: z.array(linkedinSearchSchema.extend({ index: z.number().int().min(0).max(3) })),
  maxResultsPerSearch: z.literal(50),
  maxPagesPerSearch: z.literal(5),
  maxResults: z.literal(200),
});

const linkedinJobSchema = z.strictObject({
  url: z
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        /^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/i.test(url.hostname) &&
        /^\/jobs\/view\/(?:[a-z0-9-]+-)?\d+\/?$/i.test(url.pathname)
      );
    }, "Use a LinkedIn job posting URL."),
  title: z.string().trim().min(1).max(500),
  company: z.string().trim().min(1).max(300),
  location: z.string().trim().max(500),
  description: z.string().max(100_000).default(""),
  datePosted: z.coerce.date().nullable().optional(),
});

export const linkedinIngestSchema = z
  .strictObject({
    runId: z.uuid(),
    leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
    searches: z
      .array(
        z.strictObject({
          index: z.number().int().min(0).max(3),
          status: z.enum(["ok", "blocked", "error"]),
          httpStatus: z.number().int().min(100).max(599).optional(),
          pagesFetched: z.number().int().min(0).max(5),
          jobs: z.array(linkedinJobSchema).max(50),
        }),
      )
      .min(1)
      .max(4),
  })
  .refine(
    (input) => new Set(input.searches.map((search) => search.index)).size === input.searches.length,
    {
      message: "Each saved search may occur only once.",
      path: ["searches"],
    },
  )
  .refine(
    (input) => input.searches.reduce((count, search) => count + search.jobs.length, 0) <= 200,
    {
      message: "A run may contain at most 200 results.",
      path: ["searches"],
    },
  );

export type LinkedinSearch = z.infer<typeof linkedinSearchSchema>;
export type LinkedinSettingsInput = z.infer<typeof linkedinSettingsInputSchema>;
export type LinkedinIngestInput = z.infer<typeof linkedinIngestSchema>;
