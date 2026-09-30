import { z } from "zod/v4";
import { csvArray, cursorPageSchema, cursorQuerySchema } from "../pagination";

export const PILOT_JOURNAL_KINDS = [
  "cycle",
  "action",
  "observation",
  "question",
  "system",
  "digest",
  // The user declined or edited a draft: a labeled learning signal.
  "correction",
] as const;
const pilotJournalKindSchema = z.enum(PILOT_JOURNAL_KINDS);

const pilotJournalEntryInputSchema = z.object({
  kind: pilotJournalKindSchema,
  summary: z.string(),
  detail: z.record(z.string(), z.json()).optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
});

export const createPilotJournalSchema = z.object({
  cycleId: z.string().optional(),
  entries: z.array(pilotJournalEntryInputSchema).min(1),
});

export const pilotJournalEntrySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  cycleId: z.string().nullable(),
  kind: pilotJournalKindSchema,
  summary: z.string(),
  detail: z.record(z.string(), z.json()),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  createdAt: z.date(),
});

/** Cursor-paged, not offset: the feed grows at the head while the orchestrator runs. */
export const pilotJournalQuerySchema = cursorQuerySchema.extend({
  kinds: csvArray(pilotJournalKindSchema).optional(),
});

export const pilotJournalPageSchema = cursorPageSchema(pilotJournalEntrySchema);

export type PilotJournalKind = z.infer<typeof pilotJournalKindSchema>;
export type CreatePilotJournalInput = z.infer<typeof createPilotJournalSchema>;
export type PilotJournalEntry = z.infer<typeof pilotJournalEntrySchema>;
export type PilotJournalPage = z.infer<typeof pilotJournalPageSchema>;

/** Shared by the cycle journal detail and the host's sentinel. */
export const pilotCycleStatusSchema = z.enum(["ok", "empty", "error"]);
export type PilotCycleStatus = z.infer<typeof pilotCycleStatusSchema>;

/** Optional fields: stuck-recovery cycles usually journal an empty detail. */
export const pilotCycleDetailSchema = z
  .object({
    status: pilotCycleStatusSchema.optional(),
    sleepSeconds: z.number().int().optional(),
  })
  .loose();
