import { z } from "zod/v4";

// ── Response schemas ──────────────────────────────────────────────────────────

/** A single day's count in a 30-day timeline series (`date` is UTC midnight of the bucketed day). */
const perDayPointSchema = z.object({
  date: z.date(),
  count: z.number().int(),
});

export const analyticsStatsSchema = z.object({
  totals: z.object({
    applications: z.number().int(),
    submitted: z.number().int(),
    interviewing: z.number().int(),
    offers: z.number().int(),
    rejected: z.number().int(),
    queueDepth: z.number().int(),
  }),
  thisWeek: z.object({
    submitted: z.number().int(),
    interviewing: z.number().int(),
    rejected: z.number().int(),
  }),
  responseRatePct: z.number().int(),
  statusBreakdown: z.array(
    z.object({
      status: z.string(),
      count: z.number().int(),
    }),
  ),
  perDay: z.array(perDayPointSchema),
  topBoards: z.array(
    z.object({
      board: z.string(),
      count: z.number().int(),
    }),
  ),
  topRejectReasons: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int(),
    }),
  ),
  responses: z.number().int(),
  agent: z.object({
    attempted: z.number().int(),
    submitted: z.number().int(),
    automated: z.number().int(),
    minutesSaved: z.number().int(),
    runs: z.number().int(),
    avgRunSeconds: z.number().int().nullable(),
    questionsAsked: z.number().int(),
    questionsOpen: z.number().int(),
    accountsCreated: z.number().int(),
    accountsVerified: z.number().int(),
  }),
  lastWeek: z.object({ submitted: z.number().int() }),
  matchScore: z.object({
    average: z.number().int().nullable(),
    strong: z.number().int(),
    medium: z.number().int(),
    weak: z.number().int(),
  }),
  outcomes: z.object({
    total: z.number().int(),
    rejected: z.number().int(),
    noAnswer: z.number().int(),
    withdrawn: z.number().int(),
    interviews: z.number().int(),
    offers: z.number().int(),
    noOffer: z.number().int(),
    withdrewAfterInterview: z.number().int(),
    interviewing: z.number().int(),
  }),
});
