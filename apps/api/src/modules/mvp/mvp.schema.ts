import { atsProviderSchema } from "@openapply/contracts/job-sources";
import { z } from "zod/v4";

export const sourceInput = z.object({
  provider: atsProviderSchema,
  board: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/),
});
export const sourceResult = z.object({
  imported: z.number(),
  fetched: z.number(),
  source: z.string(),
  checkedAt: z.date(),
  challenge: z.string(),
});
export const readinessResult = z.object({
  browser: z.boolean(),
  browserVersion: z.string(),
  runtime: z.string(),
  gmail: z.boolean(),
  profile: z.boolean(),
  resume: z.boolean(),
  captchaSolver: z.enum(["disabled", "enabled"]),
});
export const startInput = z.object({
  idempotencyKey: z.uuid().optional(),
  provider: z.enum(["claude", "codex"]).default("claude"),
  slugs: z.array(z.string().min(1).max(300)).min(1).max(100),
});
export const startResult = z.object({
  campaignId: z.string(),
  workItemIds: z.array(z.uuid()),
  queued: z.array(z.string()),
  jobKeys: z.array(z.string()),
  skipped: z.array(z.object({ slug: z.string(), reason: z.string() })),
});
