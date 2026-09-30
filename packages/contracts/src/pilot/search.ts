import { z } from "zod/v4";

// Shown to the user as plain text.
const reasonSchema = z.string().max(500).default("");

export const createPilotSearchSchema = z.object({
  query: z.string().min(1),
  board: z.string().optional(),
  resumeId: z.string().optional(),
  reason: reasonSchema,
});

export const updatePilotSearchSchema = createPilotSearchSchema.partial();

export const reportPilotSearchRunSchema = z.object({
  jobsSeen: z.number().int().min(0),
  newJobs: z.number().int().min(0),
  reachedEnd: z.boolean(),
});

export const pilotSearchSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  query: z.string(),
  board: z.string().nullable(),
  resumeId: z.string().nullable(),
  reason: z.string(),
  lastRunAt: z.date().nullable(),
  lastJobsSeen: z.number().int().nullable(),
  lastNewJobs: z.number().int().nullable(),
  emptyRuns: z.number().int(),
  nextRunAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const pilotSearchListSchema = z.array(pilotSearchSchema);

export type CreatePilotSearchInput = z.infer<typeof createPilotSearchSchema>;
export type UpdatePilotSearchInput = z.infer<typeof updatePilotSearchSchema>;
export type ReportPilotSearchRunInput = z.infer<typeof reportPilotSearchRunSchema>;
export type PilotSearch = z.infer<typeof pilotSearchSchema>;
