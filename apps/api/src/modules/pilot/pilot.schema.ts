import { pilotCycleStatusSchema, pilotJournalEntrySchema } from "@jobpilot/contracts/pilot";
import { z } from "zod/v4";
import { SKIP_BUCKETS } from "./skip-reasons";

export const createPilotJournalResponseSchema = z.object({
  items: z.array(pilotJournalEntrySchema),
});

export const pilotTodayOutcomesSchema = z.object({
  skipped: z.number().int(),
  failed: z.number().int(),
  skipReasons: z.array(z.object({ reason: z.enum(SKIP_BUCKETS), count: z.number().int() })),
});

export const pilotCostSchema = z.object({
  items: z.array(
    z.object({
      kind: z.string(),
      runs: z.number().int(),
      medianMs: z.number().int(),
      totalMs: z.number().int(),
      failed: z.number().int(),
      abandoned: z.number().int(),
    }),
  ),
});

export const pilotActivityResponseSchema = z.object({
  lastActivityAt: z.date().nullable(),
  activeClaims: z.number().int(),
  // The host's pre-inject gate reads this, so a probe costs no PilotState write.
  running: z.boolean(),
  // The durable completion signal the host falls back on when the sentinel is mangled.
  lastCycle: z
    .object({
      cycleId: z.string().nullable(),
      completedAt: z.date(),
      status: pilotCycleStatusSchema.nullable(),
      sleepSeconds: z.number().int().nullable(),
    })
    .nullable(),
});
