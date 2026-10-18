import { z } from "zod/v4";
import { discoveryCoverageSchema, discoverySearchSchema } from "./campaign";

export const ATS_PROVIDERS = [
  "ashby",
  "greenhouse",
  "icims",
  "lever",
  "oracle",
  "phenom",
  "recruitee",
  "smartrecruiters",
  "successfactors",
  "taleo",
  "teamtailor",
  "workable",
  "workday",
] as const;
export const atsProviderSchema = z.enum(ATS_PROVIDERS);
export const FEED_ALERTS = ["failing", "dropped", "empty"] as const;
export const DISCOVERY_PROVIDERS = ["apify", "serpapi"] as const;
export const discoveryProviderSchema = z.enum(DISCOVERY_PROVIDERS);
const inputField = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/)
  .refine(
    (v) => !/cookie|session|password|token|auth/i.test(v),
    "Session and credential inputs are not supported.",
  );
const actor = z.object({
  id: z.string().regex(/^[\w-]+[~/][\w-]+$/),
  queryField: inputField.default("query"),
  locationField: inputField.default("location"),
  limitField: inputField.default("maxItems"),
});
export const discoveryConnectionSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().trim().min(1).max(1000).optional(),
  indeedActor: actor.optional(),
  linkedinActor: actor.optional(),
  glassdoorActor: actor.optional(),
  hiringcafeActor: actor.optional(),
  ycombinatorActor: actor.optional(),
});
export const discoverInputSchema = z.object({
  campaignId: z.uuid().optional(),
  provider: discoveryProviderSchema,
  query: z.string().trim().min(2).max(200),
  location: z.string().trim().max(200).default(""),
  board: z.enum(["indeed", "linkedin", "glassdoor", "hiringcafe", "ycombinator"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const profileDiscoveryInputSchema = z.object({
  resumeId: z.uuid(),
  intent: z.enum(["preview", "apply"]).default("preview"),
  maxJobs: z.number().int().min(1).max(500).default(100),
  maxApplications: z.number().int().min(1).max(500).default(5),
  searches: z
    .array(
      discoverySearchSchema.extend({
        query: z.string().trim().min(2).max(200),
        location: z.string().trim().max(200),
      }),
    )
    .min(1)
    .max(24)
    .optional(),
});
export const profileDiscoverySchema = z.object({
  campaignId: z.uuid(),
  query: z.string(),
  resumeId: z.uuid(),
  minScore: z.number().int(),
  searches: z.array(discoverySearchSchema),
  coverage: discoveryCoverageSchema,
});
export const completeDiscoverySchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export const applyDiscoverySchema = z.object({
  maxApplications: z.number().int().min(1).max(500).default(5),
});
export const initializeDiscoverySchema = z.object({
  intent: z.enum(["preview", "apply"]),
  resumeId: z.uuid().optional(),
});
export const discoveryResultSchema = z.object({
  imported: z.number(),
  fetched: z.number(),
  resolved: z.number(),
  saved: z.number().optional(),
  requests: z.number().optional(),
  truncated: z.boolean().optional(),
});
export const boardInputSchema = z.object({
  provider: atsProviderSchema,
  slug: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/),
  campaignId: z.uuid().optional(),
});
