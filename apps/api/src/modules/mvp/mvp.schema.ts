import { z } from "zod/v4";

export const sourceInput = z.object({
  provider: z.enum(["ashby", "greenhouse"]),
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
  captchaSolver: z.literal("disabled"),
});
export const startInput = z.object({ slug: z.string().min(1).max(300) });
export const startResult = z.object({
  campaignId: z.string(),
  title: z.string(),
  company: z.string(),
});
export const observationResult = z.object({
  url: z.string(),
  title: z.string(),
  widgetPresent: z.boolean(),
  challengePage: z.boolean(),
  checkedAt: z.date(),
});
