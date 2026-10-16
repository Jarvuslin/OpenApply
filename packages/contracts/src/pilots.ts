import { z } from "zod/v4";
import { AGENT_PROVIDERS } from "./agent";
import { JOB_LEVELS, JOB_WORK_MODES } from "./job-listing";
import { paginatedSchema, paginationQuerySchema } from "./pagination";

export const PILOT_MATCH_MODES = ["review", "queue"] as const;
export const PILOT_RUN_TRIGGERS = ["manual", "schedule"] as const;
export const PILOT_RUN_STATES = ["scoring", "done", "stopped", "failed"] as const;
export const PILOT_RESULT_STATUSES = [
  "scoring",
  "review",
  "added",
  "removed",
  "below_fit",
  "unscored",
] as const;
const PILOT_COMPANY_TYPES = ["startup", "scale_up", "enterprise", "agency"] as const;
/** Posted-within windows in minutes. No window selected means any time. */
const PILOT_POSTED_WINDOWS = [30, 60, 360, 1440, 4320] as const;
/** Auto-run intervals in minutes; 2 is "always on". */
const PILOT_INTERVALS = [2, 10, 30, 60, 360, 1440] as const;

const term = z.string().trim().min(1).max(80);
const terms = z.array(term).max(30).default([]);
const oneOf = <T extends readonly number[]>(values: T) =>
  z
    .number()
    .int()
    .refine((value) => values.includes(value), { message: `Use one of ${values.join(", ")}.` });

export const pilotRulesSchema = z.object({
  roles: terms,
  levels: z.array(z.enum(JOB_LEVELS.filter((level) => level !== "unknown"))).default([]),
  companyTypes: z.array(z.enum(PILOT_COMPANY_TYPES)).default([]),
  locations: terms,
  workModes: z.array(z.enum(JOB_WORK_MODES)).default([]),
  keywords: terms,
  excludeKeywords: terms,
  companies: terms,
  skipCompanies: terms,
  postedWithin: z.array(oneOf(PILOT_POSTED_WINDOWS)).default([]),
  /** Also keep jobs that ask for no prior experience. */
  noExperience: z.boolean().default(false),
  /** Years of experience a posting asks for; null leaves that end open. */
  minYears: z.number().int().min(0).max(50).nullable().default(null),
  maxYears: z.number().int().min(0).max(50).nullable().default(null),
  /** Keep postings that don't state a level or company type and let the fit score decide. */
  includeUnknown: z.boolean().default(true),
});

export const pilotInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rules: pilotRulesSchema,
  resumeId: z.uuid(),
  minScore: z.number().int().min(0).max(100),
  autoRun: z.boolean(),
  intervalMinutes: oneOf(PILOT_INTERVALS),
  mode: z.enum(PILOT_MATCH_MODES),
  maxJobsPerRun: z.number().int().min(1).max(50),
  provider: z.enum(AGENT_PROVIDERS),
});
export const updatePilotSchema = pilotInputSchema.partial();

export const pilotRunSchema = z.object({
  id: z.uuid(),
  trigger: z.enum(PILOT_RUN_TRIGGERS),
  state: z.enum(PILOT_RUN_STATES),
  scanned: z.number().int(),
  matched: z.number().int(),
  /** Results of this run the agent has scored so far, out of `matched`. */
  scored: z.number().int(),
  reason: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});

export const pilotSchema = pilotInputSchema.extend({
  id: z.uuid(),
  rules: pilotRulesSchema,
  resumeLabel: z.string().nullable(),
  nextRunAt: z.date().nullable(),
  createdAt: z.date(),
  counts: z.object({
    review: z.number().int(),
    added: z.number().int(),
    removed: z.number().int(),
    belowFit: z.number().int(),
  }),
  lastRun: pilotRunSchema.nullable(),
});
export const pilotListSchema = z.array(pilotSchema);

const pilotResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(PILOT_RESULT_STATUSES),
  windowMinutes: z.number().int().nullable(),
  postedAt: z.date().nullable(),
  foundAt: z.date(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  url: z.string(),
  matchScore: z.number().int().nullable(),
  level: z.enum(JOB_LEVELS),
  workMode: z.enum(JOB_WORK_MODES).nullable(),
});
export const pilotResultsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PILOT_RESULT_STATUSES).default("review"),
  sort: z.enum(["newest", "match"]).default("newest"),
});
export const pilotResultListSchema = paginatedSchema(pilotResultSchema);

export const pilotResultActionSchema = z
  .object({
    resultIds: z.array(z.uuid()).max(200).optional(),
    /** Every result still waiting for review. */
    all: z.boolean().optional(),
  })
  .refine((value) => value.all || value.resultIds?.length, {
    message: "Pick at least one job, or choose all.",
  });
export const pilotResultActionResponseSchema = z.object({
  updated: z.number().int(),
  skipped: z.array(z.object({ resultId: z.uuid(), reason: z.string() })),
});

export const pilotPreviewSchema = z.object({ rules: pilotRulesSchema });
export const pilotPreviewResponseSchema = z.object({
  windows: z.array(z.object({ minutes: z.number().int().nullable(), count: z.number().int() })),
});

export type PilotRules = z.infer<typeof pilotRulesSchema>;
export type PilotInput = z.infer<typeof pilotInputSchema>;
