import { z } from "zod/v4";

/** Stored as JSON in `PilotState.instructionsConfig`; `{}` parses to a full config. */
export const pilotInstructionsConfigSchema = z.object({
  dailyApplyCap: z.number().int().min(0).default(10),
  minScore: z.number().min(0).max(100).default(60),
  boards: z.array(z.string()).default([]),
  checkIntervalMinutes: z.number().int().min(5).default(30),
});

/** What to retire from the old goals. Nothing by default, so the web asks before sending any. */
export const pilotInstructionsChangeSchema = z.object({
  // `strategy.bootstrap` only runs once no searches exist, so deleting them is what re-derives.
  rederiveSearches: z.boolean().default(false),
  completeCampaigns: z.boolean().default(false),
  dropApprovedJobs: z.boolean().default(false),
});

export const NO_INSTRUCTIONS_CHANGE: PilotInstructionsChange = pilotInstructionsChangeSchema.parse(
  {},
);

export const updatePilotInstructionsSchema = z.object({
  goals: z.string().trim().min(1, "Write the pilot's goals before saving."),
  config: pilotInstructionsConfigSchema,
  onChange: pilotInstructionsChangeSchema.prefault({}),
});

export const pilotInstructionsImpactSchema = z.object({
  searches: z.array(z.object({ id: z.uuid(), query: z.string(), reason: z.string() })),
  campaigns: z.array(
    z.object({ campaignId: z.uuid(), query: z.string(), approvedJobs: z.number().int() }),
  ),
  approvedJobs: z.number().int(),
  oldestApprovedAt: z.date().nullable(),
});

export const pilotStateSchema = z.object({
  userId: z.uuid(),
  running: z.boolean(),
  instructionsGoals: z.string(),
  instructionsConfig: pilotInstructionsConfigSchema,
  instructionsUpdatedAt: z.date().nullable(),
  lastCycleAt: z.date().nullable(),
  cycleCount: z.number().int(),
  appliedToday: z.number().int(),
  capReached: z.boolean(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PilotInstructionsConfig = z.infer<typeof pilotInstructionsConfigSchema>;
export type PilotInstructionsChange = z.infer<typeof pilotInstructionsChangeSchema>;
export type PilotInstructionsImpact = z.infer<typeof pilotInstructionsImpactSchema>;
export type UpdatePilotInstructionsInput = z.infer<typeof updatePilotInstructionsSchema>;
export type PilotState = z.infer<typeof pilotStateSchema>;

/** How one channel runs, or null when it is off. */

// A warm intro prefers email when both channels are on.

/** How a new outreach message goes out, or null when every channel is off. */
