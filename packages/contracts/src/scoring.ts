import { z } from "zod/v4";
import { jobPreferencesSchema, ROLE_FAMILIES, workAuthorizationSchema } from "./user";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const FIT_RUBRIC_VERSION = 2 as const;
const explanationSchema = z.string().trim().min(1).max(4_000);
const spanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1).max(20_000),
});

export const scoreContextInputSchema = z.strictObject({
  campaignId: z.uuid(),
  jobKey: z.string().min(1).max(200),
  resumeId: z.uuid().optional(),
});

const basisSchema = z.object({
  // Historical judgments retain their original rubric; reading them never upgrades their meaning.
  version: z.union([z.literal(1), z.literal(FIT_RUBRIC_VERSION)]),
  resumeId: z.uuid(),
  sourceSha256: hashSchema,
  sourceTextSha256: hashSchema,
  jobSha256: hashSchema,
  preferencesSha256: hashSchema,
});

const criterionSchema = z.object({
  id: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1),
  section: z.enum(["requirements", "responsibilities", "other"]),
  isHeading: z.boolean(),
});

const assessmentSchema = z.object({
  criterionId: z.string().min(1),
  category: z.enum(["requirement", "responsibility", "context"]),
  rating: z.enum([
    "strong",
    "partial",
    "unsupported",
    "contradicted",
    "uncertain",
    "not_applicable",
  ]),
  evidence: z.array(spanSchema).max(12),
  explanation: explanationSchema,
});

const roleMatchSchema = z.object({
  family: z.enum([...ROLE_FAMILIES, "Other", "Unclear"]),
  evidence: z
    .array(spanSchema.extend({ source: z.enum(["title", "description"]) }))
    .min(1)
    .max(8),
  explanation: explanationSchema,
});

const postingEvidenceSchema = spanSchema.extend({
  source: z.enum(["title", "description", "location", "type"]),
});
const preferenceCheckSchema = z.object({
  status: z.enum(["matched", "not_restricted", "mismatch", "unknown"]),
  explanation: explanationSchema,
  evidence: z.array(postingEvidenceSchema).max(8),
});
const preferenceChecksSchema = z.object({
  level: preferenceCheckSchema,
  workMode: preferenceCheckSchema,
  employmentType: preferenceCheckSchema,
  location: preferenceCheckSchema,
  eligibility: z
    .array(
      z.object({
        requirement: z.string().trim().min(1).max(2_000),
        status: z.enum(["met", "not_met", "unknown"]),
        explanation: explanationSchema,
        evidence: z.array(postingEvidenceSchema).min(1).max(8),
      }),
    )
    .max(30),
});

export const scoreAssessmentInputSchema = scoreContextInputSchema.extend({
  basis: basisSchema,
  assessments: z.array(assessmentSchema).min(1).max(500),
  roleMatch: roleMatchSchema,
  preferenceChecks: preferenceChecksSchema.optional(),
});

const componentSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  count: z.number().int().nonnegative(),
  weight: z.number().min(0).max(1),
});

export const fitAssessmentSchema = z.object({
  basis: basisSchema,
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  confidenceMeaning: z.literal(
    "Fraction of scored criteria without an uncertain rating; not a probability of hiring.",
  ),
  judgment: z.literal(
    "Semantic ratings are agent judgments; source quotations and score arithmetic are validated by the server.",
  ),
  verdict: z.enum(["assessed", "needs_review"]),
  components: z.object({ requirements: componentSchema, responsibilities: componentSchema }),
  assessments: z
    .array(assessmentSchema.extend({ criterion: criterionSchema }))
    .min(1)
    .max(500),
  roleMatch: roleMatchSchema.extend({
    relevance: z.enum(["matched", "outside_preferences", "unclear", "not_restricted"]),
  }),
  preferenceChecks: preferenceChecksSchema.optional(),
  strongMatches: z.array(z.string()),
  partialMatches: z.array(z.string()),
  gaps: z.array(z.string()),
  matchReason: z.string(),
});

export const fitContextSchema = z.object({
  basis: basisSchema,
  job: z.object({
    title: z.string(),
    company: z.string(),
    url: z.string(),
    location: z.string().nullable(),
    type: z.string().nullable(),
    description: z.string(),
    criteria: z.array(criterionSchema).min(1).max(500),
  }),
  resume: z.object({ text: z.string() }),
  preferences: z.object({
    jobPreferences: jobPreferencesSchema,
    preferredLocations: z.array(z.string()),
    workAuthorization: workAuthorizationSchema,
  }),
  minMatchScore: z.number().int().min(0).max(100),
  cachedAssessment: fitAssessmentSchema.nullable(),
});

export type ScoreContextInput = z.infer<typeof scoreContextInputSchema>;
export type ScoreAssessmentInput = z.infer<typeof scoreAssessmentInputSchema>;
export type FitAssessment = z.infer<typeof fitAssessmentSchema>;
export type FitContext = z.infer<typeof fitContextSchema>;
