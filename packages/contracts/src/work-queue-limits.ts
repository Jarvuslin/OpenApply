import { z } from "zod/v4";

export const queueLimitsSchema = z.object({
  revision: z.number().int().min(0),
  maxConcurrentWorkers: z.number().int().min(1).max(3),
  dailyApplicationCap: z.number().int().min(1).max(500),
  companyApplicationCap: z.number().int().min(1).max(100),
  companyWindowDays: z.number().int().min(1).max(90),
  domainDelaySeconds: z.number().int().min(1).max(3600),
  // Null means no limit; each claimed run uses one.
  runsRemaining: z.number().int().min(0).max(10000).nullable().optional(),
  // A failed run is diagnosed and queued again, at most twice, after a short wait.
  autoRetryFailed: z.boolean().optional(),
  updatedAt: z.date().nullable(),
});
export const updateQueueLimitsSchema = queueLimitsSchema
  .omit({ revision: true, updatedAt: true })
  .extend({ requestId: z.uuid(), expectedRevision: z.number().int().min(0) })
  .strict();
export const QUEUE_BLOCK_REASONS = [
  "user_decision",
  "company_excluded",
  "settled_request",
  "work_not_queued",
  "capacity",
  "exclusive_work",
  "domain_busy",
  "domain_pacing",
  "daily_cap",
  "company_cap",
  "campaign_cap",
  "campaign_paused",
  "questions",
  "submission_outcome",
  "artifact_unavailable",
  "pilot_limit",
  "blocked_site",
  "unknown_scope",
  "run_limit",
] as const;
export const queueEstimateQuerySchema = z.object({ campaignId: z.uuid().optional() });
export const queueEstimateSchema = z.object({
  asOf: z.date(),
  policy: queueLimitsSchema,
  counts: z.object({
    queuedApplications: z.number().int(),
    activeWorkers: z.number().int(),
    heldReservations: z.number().int(),
    consumedReservations: z.number().int(),
    submittedToday: z.number().int(),
    eligibleNow: z.number().int(),
    deferred: z.number().int(),
  }),
  deferred: z.array(
    z.object({
      reason: z.enum(QUEUE_BLOCK_REASONS),
      count: z.number().int(),
      nextEligibleAt: z.date().nullable(),
    }),
  ),
  domains: z.array(
    z.object({
      domainKey: z.string(),
      queued: z.number().int(),
      active: z.number().int(),
      nextEligibleAt: z.date().nullable(),
    }),
  ),
  domainCount: z.number().int(),
  domainsTruncated: z.boolean(),
  usage: z.object({
    modelRequests: z.null(),
    inputTokens: z.null(),
    outputTokens: z.null(),
    durationMs: z.null(),
    proRemaining: z.null(),
    provenance: z.literal("unavailable"),
  }),
});
export type QueueLimits = z.infer<typeof queueLimitsSchema>;
export type UpdateQueueLimits = z.infer<typeof updateQueueLimitsSchema>;
export type QueueEstimate = z.infer<typeof queueEstimateSchema>;
/** Queued work the computer may start now, already capped by the run limit. */
export const queueRunnableSchema = z.object({
  applicationIds: z.array(z.uuid()),
  accountIds: z.array(z.uuid()),
  /** At most one pilot run to score; it runs alone like account setup. */
  pilotIds: z.array(z.uuid()),
  maxConcurrentWorkers: z.number().int().min(1).max(3),
  runsRemaining: z.number().int().min(0).nullable(),
});
