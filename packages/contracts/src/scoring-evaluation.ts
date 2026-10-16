import { z } from "zod/v4";
import { paginatedSchema } from "./pagination";
import { fitAssessmentSchema, fitContextSchema, scoreAssessmentInputSchema } from "./scoring";

export const EVALUATION_ORIGINS = ["historical", "simulated", "local_inference"] as const;
export const EVALUATION_SLOTS = ["baseline", "candidate"] as const;
export const EVALUATION_STATUSES = ["completed", "failed", "budget_stopped", "rejected"] as const;
export const EVALUATION_COHORTS = ["owned", "historical_synthetic", "authored"] as const;
export const EVALUATION_MODELS = ["sonnet", "haiku"] as const;
export const EVALUATION_FAILURES = [
  "invalid_output",
  "missing_usage",
  "budget_requests",
  "budget_tokens",
  "budget_time",
  "output_limit",
  "provider_error",
  "cancelled",
  "model_mismatch",
  "unsafe_tool_use",
] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().min(0).max(1_000_000_000_000).nullable();
export const evaluationJudgmentsSchema = scoreAssessmentInputSchema.omit({
  campaignId: true,
  jobKey: true,
  resumeId: true,
  basis: true,
});
const evaluationFactsSchema = z.strictObject({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  confirmed: z.literal(true),
  authorized: z.boolean().optional(),
  requiresSponsorship: z.boolean().optional(),
  citizen: z.boolean().optional(),
  activeClearance: z.boolean().optional(),
});
export const createEvaluationSchema = z
  .strictObject({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    cohort: z.enum(EVALUATION_COHORTS),
    escalationBand: z.number().int().min(0).max(20).default(5),
    cases: z
      .array(
        z.strictObject({
          jobId: z.uuid(),
          expectedBasis: fitContextSchema.shape.basis,
          facts: evaluationFactsSchema.optional(),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine(
    (input) => new Set(input.cases.map((row) => row.jobId)).size === input.cases.length,
    "Each job can appear only once in a run.",
  );
const evaluationTelemetrySchema = z.strictObject({
  provenance: z.enum(["provider_observed", "unavailable", "simulated"]),
  latencyMs: counter,
  requests: counter,
  inputTokens: counter,
  cacheWriteTokens: counter,
  cacheReadTokens: counter,
  outputTokens: counter,
});
export const evaluationResultInputSchema = z
  .strictObject({
    requestId: z.uuid(),
    expectedContextHash: hash,
    slot: z.enum(EVALUATION_SLOTS),
    origin: z.enum(EVALUATION_ORIGINS),
    requestedModel: z.enum(EVALUATION_MODELS),
    actualModels: z.array(z.string().min(1).max(120)).max(8),
    modelVersion: z.string().min(1).max(120).nullable(),
    status: z.enum(["completed", "failed", "budget_stopped"]),
    judgments: evaluationJudgmentsSchema.nullable(),
    failureCode: z.enum(EVALUATION_FAILURES).nullable(),
    telemetry: evaluationTelemetrySchema,
    requestIdentityHashes: z.array(hash).max(100).default([]),
  })
  .refine(
    (input) => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 1_000_000,
    "Evaluation output exceeds one megabyte.",
  );
const evaluationEligibilitySchema = z.object({
  outcome: z.enum(["no_known_restriction", "eligible", "ineligible", "needs_review"]),
  facts: evaluationFactsSchema.nullable(),
  restrictions: z
    .array(
      z.object({
        kind: z.enum(["authorization", "sponsorship", "citizenship", "clearance"]),
        source: z.enum(["title", "description"]),
        start: z.number().int(),
        end: z.number().int(),
        quote: z.string(),
        countryCode: z.string().nullable(),
        outcome: z.enum(["met", "not_met", "unknown"]),
      }),
    )
    .max(100),
});
export const evaluationResultSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  slot: z.enum(EVALUATION_SLOTS),
  origin: z.enum(EVALUATION_ORIGINS),
  requestedModel: z.enum(EVALUATION_MODELS),
  actualModels: z.array(z.string()),
  modelVersion: z.string().nullable(),
  status: z.enum(EVALUATION_STATUSES),
  failureCode: z.enum(EVALUATION_FAILURES).nullable(),
  assessment: fitAssessmentSchema.nullable(),
  telemetry: evaluationTelemetrySchema,
  validationReason: z.string().nullable(),
  createdAt: z.date(),
  verification: z.literal("reported"),
});
export const evaluationRunSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cohort: z.enum(EVALUATION_COHORTS),
  caseCount: z.number().int(),
  baselineModel: z.literal("sonnet"),
  candidateModel: z.literal("haiku"),
  escalationBand: z.number().int(),
  policyVersion: z.literal(1),
  createdAt: z.date(),
  productionScoresUnchanged: z.literal(true),
});
export const evaluationCaseSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  ordinal: z.number().int(),
  jobId: z.uuid(),
  campaignId: z.uuid(),
  jobKey: z.string(),
  contextHash: hash,
  context: fitContextSchema,
  historicalReference: fitAssessmentSchema.nullable(),
  eligibility: evaluationEligibilitySchema,
  factsConfirmedAt: z.date().nullable(),
  results: z.array(evaluationResultSchema).max(2),
});
const metrics = z.object({
  pairs: z.number().int(),
  exactScoreAgreement: z.number().nullable(),
  meanAbsoluteScoreDifference: z.number().nullable(),
  cutoffAgreement: z.number().nullable(),
  candidatePassBaselineFail: z.number().int(),
  candidateFailBaselinePass: z.number().int(),
  decisionDisagreements: z.number().int(),
  roleDisagreements: z.number().int(),
  preferenceDisagreements: z.number().int(),
  escalationCases: z.number().int(),
});
const measurement = z.object({
  available: z.number().int(),
  unavailable: z.number().int(),
  total: z.number().nullable(),
  mean: z.number().nullable(),
});
const usage = z.object({
  results: z.number().int(),
  latencyMs: measurement,
  requests: measurement,
  inputTokens: measurement,
  cacheWriteTokens: measurement,
  cacheReadTokens: measurement,
  outputTokens: measurement,
});
export const evaluationReportSchema = z.object({
  run: evaluationRunSchema,
  totalCases: z.number().int(),
  validPairs: z.number().int(),
  measuredPairs: z.number().int(),
  excludedPairs: z.number().int(),
  failedCases: z.number().int(),
  unrunCases: z.number().int(),
  incompleteCases: z.number().int(),
  comparison: metrics,
  measured: metrics,
  usage: z.object({ baseline: usage, candidate: usage }),
  measurementStatus: z.enum(["not_run", "partial", "measured"]),
  limitations: z.array(z.string()),
});
export const evaluationRunsSchema = paginatedSchema(evaluationRunSchema);
export const evaluationCasesSchema = paginatedSchema(evaluationCaseSchema);
export type CreateEvaluation = z.infer<typeof createEvaluationSchema>;
export type EvaluationFacts = z.infer<typeof evaluationFactsSchema>;
export type EvaluationEligibility = z.infer<typeof evaluationEligibilitySchema>;
export type EvaluationResultInput = z.infer<typeof evaluationResultInputSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
