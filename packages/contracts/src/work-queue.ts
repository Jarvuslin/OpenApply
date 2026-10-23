import { z } from "zod/v4";
import { accountSetupExecutionSchema } from "./account-setup";
import { AGENT_EVENT_KINDS, AGENT_NAMES, AGENT_PROVIDERS, agentEventMetadataSchema } from "./agent";
import { intakePreparationExecutionSchema } from "./intake-preparation";
import { paginatedSchema, paginationQuerySchema } from "./pagination";
import { QUEUE_BLOCK_REASONS } from "./work-queue-limits";

export const WORK_KINDS = ["application", "pilot_task"] as const;
export const WORK_STATES = [
  "queued",
  "preparing",
  "ready",
  "filling",
  "needs_user",
  "submitted",
  "skipped",
  "failed",
  "paused",
  "stopping",
  "cancelled",
  "completed",
] as const;
export const WORK_SOURCES = ["user", "campaign", "mvp", "discovery", "pilot", "migration"] as const;
export const WORK_INTENTS = [
  "account_setup",
  "intake_prepare",
  "campaign_start",
  "campaign_resume",
  "campaign_rescan",
  "campaign_retry_failed",
  "search",
  "inbox",
  "pilot_score",
  "unavailable",
] as const;
/** Days a submission screenshot is kept before the daily cleanup deletes it. */
export const SUBMISSION_SCREENSHOT_DAYS = 14;

export const workItemSchema = z.object({
  priorityRequestedAt: z.date().nullable(),
  id: z.uuid(),
  kind: z.enum(WORK_KINDS),
  intent: z.enum(WORK_INTENTS).nullable(),
  intakeId: z.uuid().nullable(),
  state: z.enum(WORK_STATES),
  source: z.enum(WORK_SOURCES),
  provider: z.enum(AGENT_PROVIDERS),
  jobId: z.uuid().nullable(),
  jobKey: z.string().nullable(),
  campaignId: z.uuid().nullable(),
  applicationId: z.uuid().nullable(),
  title: z.string(),
  company: z.string().nullable(),
  url: z.string().nullable(),
  matchScore: z.number().int().nullable(),
  /** The resume picked for this application, else the one its search was set to use. */
  resumeLabel: z.string().nullable(),
  hasScreenshot: z.boolean(),
  reason: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  leaseExpiresAt: z.date().nullable(),
  cancellationRequestedAt: z.date().nullable(),
  pauseRequestedAt: z.date().nullable(),
});
export const workEventSchema = z.object({
  id: z.uuid(),
  workItemId: z.uuid(),
  eventId: z.uuid(),
  kind: z.enum(AGENT_EVENT_KINDS),
  content: z.string(),
  metadata: agentEventMetadataSchema.nullable(),
  createdAt: z.date(),
});
export const WORK_VIEW_STATES = {
  /** Everything still in flight; finished work leaves the default list. */
  active: ["queued", "paused", "preparing", "ready", "filling", "stopping", "needs_user"],
  next: ["queued", "paused"],
  running: ["preparing", "ready", "filling", "stopping"],
  waiting: ["needs_user"],
  done: ["submitted", "completed"],
  failed: ["failed", "skipped", "cancelled"],
} as const satisfies Record<string, readonly (typeof WORK_STATES)[number][]>;
export const workListQuerySchema = paginationQuerySchema.extend({
  state: z.enum(WORK_STATES).optional(),
  view: z.enum(["active", "next", "running", "waiting", "done", "failed"]).optional(),
});
export const workListSchema = paginatedSchema(workItemSchema);
export const workDetailSchema = z.object({
  item: workItemSchema,
  events: z.array(workEventSchema),
});
export const workSummarySchema = z.object({
  queued: z.number(),
  running: z.number(),
  needsUser: z.number(),
  paused: z.number(),
  total: z.number(),
});
export const enqueueWorkSchema = z.object({
  idempotencyKey: z.uuid(),
  jobIds: z.array(z.uuid()).min(1).max(100),
  source: z.enum(WORK_SOURCES).default("user"),
  provider: z.enum(AGENT_PROVIDERS).default("claude"),
});
export const enqueueCampaignWorkSchema = z.object({
  idempotencyKey: z.uuid(),
  action: z.enum(["start", "resume", "rescan", "retry_failed"]),
  jobIds: z.array(z.uuid()).min(1).max(100).optional(),
  provider: z.enum(AGENT_PROVIDERS).default("claude"),
});
export const enqueueWorkResultSchema = z.object({ items: z.array(workItemSchema) });
export const controlWorkSchema = z.object({ action: z.enum(["pause", "resume", "stop"]) });
export const removeWorkResultSchema = z.object({ removed: z.boolean() });
export const workLeaseSchema = z.object({ leaseToken: z.uuid() });
export const workEventInputSchema = workLeaseSchema.extend({
  eventId: z.uuid(),
  kind: z.enum(AGENT_EVENT_KINDS),
  content: z.string().max(32000),
  metadata: agentEventMetadataSchema.omit({ authorship: true }).optional(),
  providerSessionId: z.string().max(500).optional(),
});
export const finishWorkSchema = workLeaseSchema.extend({
  status: z.enum(["completed", "failed", "cancelled", "waiting"]),
  error: z.string().max(4000).optional(),
});
export const workClaimInputSchema = z
  .object({
    requestId: z.uuid(),
    runtimeId: z.uuid(),
    workerId: z.uuid(),
    workItemId: z.uuid(),
    accountSnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    preparationSnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    capabilities: z
      .object({ isolatedBrowser: z.literal(true), accountSetup: z.literal(true).optional() })
      .strict(),
  })
  .strict();
export const workClaimSchema = z.object({
  claim: z
    .object({
      item: workItemSchema,
      leaseToken: z.uuid(),
      ownership: z.object({
        runtimeId: z.uuid(),
        workerId: z.uuid(),
        slot: z.number().int().min(1).max(3),
        executionId: z.uuid(),
        browserSessionId: z.uuid(),
      }),
      leaseExpiresAt: z.date(),
      policyRevision: z.number().int(),
      execution: z.object({
        provider: z.enum(AGENT_PROVIDERS),
        agent: z.enum(AGENT_NAMES),
        prompt: z.string(),
        instructions: z.string(),
        providerSessionId: z.string().nullable(),
        intent: z.enum(WORK_INTENTS).nullable(),
        preparation: intakePreparationExecutionSchema.nullable(),
        accountSetup: accountSetupExecutionSchema.nullable().optional(),
        /** The only job pages a pilot scoring run's browser may open. */
        scorePages: z
          .array(z.object({ jobId: z.uuid(), url: z.string() }))
          .max(50)
          .nullable()
          .optional(),
        job: z
          .object({
            id: z.uuid(),
            campaignId: z.uuid(),
            key: z.string(),
            title: z.string(),
            company: z.string(),
            url: z.string(),
          })
          .nullable(),
      }),
    })
    .nullable(),
  serverTime: z.date(),
  blockedReason: z.enum(QUEUE_BLOCK_REASONS).nullable(),
  nextEligibleAt: z.date().nullable(),
});
export type WorkClaimInput = z.infer<typeof workClaimInputSchema>;
export const workOrderedInputSchema = z.strictObject({
  workItemIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Work IDs must be unique."),
});
export const workOrderedSchema = z.object({
  serverTime: z.date(),
  items: z.array(
    z.object({
      workItemId: z.uuid(),
      eligible: z.boolean(),
      blockedReason: z.enum(QUEUE_BLOCK_REASONS).nullable(),
      nextEligibleAt: z.date().nullable(),
      priorityRequestedAt: z.date().nullable(),
    }),
  ),
});
export const workObserverQuerySchema = z.strictObject({
  executionId: z.uuid(),
  browserSessionId: z.uuid(),
});
export const workObserverSchema = z.object({
  ownerId: z.uuid(),
  workItemId: z.uuid(),
  executionId: z.uuid(),
  browserSessionId: z.uuid(),
  currentExecutionId: z.uuid().nullable(),
  state: z.enum(WORK_STATES),
  leaseExpiresAt: z.date().nullable(),
  active: z.boolean(),
});
export const workScheduleInputSchema = z.object({
  provider: z.enum(AGENT_PROVIDERS).default("claude"),
});
export const workScheduleSchema = z.object({ enqueued: z.number().int() });
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkState = WorkItem["state"];
export type WorkListQuery = z.infer<typeof workListQuerySchema>;
export type EnqueueWork = z.infer<typeof enqueueWorkSchema>;
export type EnqueueCampaignWork = z.infer<typeof enqueueCampaignWorkSchema>;
export type WorkEventInput = z.infer<typeof workEventInputSchema>;
export type FinishWork = z.infer<typeof finishWorkSchema>;

export const WORK_TIMELINE_KINDS = [
  "found",
  "scored",
  "queued",
  "started",
  "stopped",
  "asked",
  "answered",
  "reviewed",
  "submitting",
  "confirmed",
  "waiting",
  "failed",
] as const;
/** One milestone of an application's life, for the Queue's activity view. */
export const workTimelineEntrySchema = z.object({
  kind: z.enum(WORK_TIMELINE_KINDS),
  at: z.date().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  /** Done by the agent rather than by the person. */
  automated: z.boolean(),
});
export const workTimelineSchema = z.object({ entries: z.array(workTimelineEntrySchema) });
