import { z } from "zod/v4";

export const ATS_PROVIDERS = [
  "ashby",
  "greenhouse",
  "lever",
  "smartrecruiters",
  "workable",
] as const;
export const atsProviderSchema = z.enum(ATS_PROVIDERS);
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
});
export const discoverInputSchema = z.object({
  provider: discoveryProviderSchema,
  query: z.string().trim().min(2).max(200),
  location: z.string().trim().max(200).default(""),
  board: z.enum(["indeed", "linkedin"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
