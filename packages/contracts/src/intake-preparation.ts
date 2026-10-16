import { z } from "zod/v4";
import { AGENT_PROVIDERS } from "./agent";
import { jobQuestionsSchema, questionObservationSchema } from "./application-question";
import { fitContextSchema, scoreAssessmentInputSchema } from "./scoring";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const intakePreparationSnapshotSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.literal("intake_prepare"),
  workItemId: z.uuid(),
  intakeId: z.uuid(),
  intakeRevision: z.number().int().positive(),
  jobId: z.uuid(),
  campaignId: z.uuid(),
  jobKey: z.string().min(1).max(200),
  url: z.url().max(4000),
  provider: z.enum(AGENT_PROVIDERS),
  resumeId: z.uuid(),
  sourceSha256: hash,
  sourceTextSha256: hash,
  preferencesSha256: hash,
  snapshotHash: hash,
});
export const intakePreparationExecutionSchema = z.strictObject({
  snapshot: intakePreparationSnapshotSchema,
  apiToken: z.string().min(1),
});
export const intakePreparationContextSchema = z.object({
  snapshot: intakePreparationSnapshotSchema,
  job: fitContextSchema.shape.job.omit({ criteria: true }),
  resume: fitContextSchema.shape.resume,
  fit: fitContextSchema.nullable(),
  questions: jobQuestionsSchema,
});
export const intakePreparationPostingSchema = z.strictObject({
  description: z.string().trim().min(200).max(100_000),
});
export const intakePreparationFitSchema = scoreAssessmentInputSchema
  .omit({ campaignId: true, jobKey: true, resumeId: true })
  .strict();
export const intakePreparationQuestionsSchema = questionObservationSchema.strict();
export type IntakePreparationSnapshot = z.infer<typeof intakePreparationSnapshotSchema>;
export type IntakePreparationPosting = z.infer<typeof intakePreparationPostingSchema>;
export type IntakePreparationFit = z.infer<typeof intakePreparationFitSchema>;
export type IntakePreparationQuestions = z.infer<typeof intakePreparationQuestionsSchema>;
