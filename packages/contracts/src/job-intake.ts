import { z } from "zod/v4";
import { AGENT_PROVIDERS } from "./agent";
import { paginatedSchema, paginationQuerySchema } from "./pagination";

export const INTAKE_DECISIONS = ["pending", "apply_now", "queue", "skip"] as const;
export const intakeCreateSchema = z
  .object({ requestId: z.uuid(), url: z.url().max(2000) })
  .strict();
export const intakeDecisionSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["apply_now", "queue", "skip"]),
    provider: z.enum(AGENT_PROVIDERS).optional(),
  })
  .strict();
export const jobIntakeSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  url: z.string(),
  canonicalUrl: z.string(),
  jobId: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  jobKey: z.string().nullable(),
  title: z.string(),
  company: z.string().nullable(),
  decision: z.enum(INTAKE_DECISIONS),
  preparation: z.enum(["pending", "ready", "unresolved", "already_applied"]),
  reason: z.string(),
  matchScore: z.number().nullable(),
  questionsPending: z.boolean(),
  unansweredCount: z.number().int().nonnegative(),
  provider: z.enum(AGENT_PROVIDERS).nullable(),
  workItemId: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const intakeListQuerySchema = paginationQuerySchema;
export const intakeListSchema = paginatedSchema(jobIntakeSchema);
export type IntakeCreate = z.infer<typeof intakeCreateSchema>;
export type IntakeDecision = z.infer<typeof intakeDecisionSchema>;
export const intakePrepareSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    provider: z.enum(AGENT_PROVIDERS),
  })
  .strict();
export type IntakePrepare = z.infer<typeof intakePrepareSchema>;
