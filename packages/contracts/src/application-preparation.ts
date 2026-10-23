import { z } from "zod/v4";
import {
  applicationQuestionSchema,
  jobQuestionsSchema,
  QUESTION_COVERAGES,
  questionAnswerValuesSchema,
} from "./application-question";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PREPARATION_MODES = ["preview", "worker"] as const;
export const PREPARATION_STATUSES = ["filled", "partial", "blocked"] as const;
export const preparationQuerySchema = z.object({
  mode: z.enum(PREPARATION_MODES).default("preview"),
});
export const selectQuestionDocumentSchema = z.object({
  requestId: z.uuid(),
  jobId: z.uuid(),
  expectedCollectionVersion: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  expectedDefinitionHash: hash,
  fieldKey: z.string().min(1).max(200),
  resumeId: z.uuid(),
  variantId: z.uuid().optional(),
  artifactRevision: hash,
  expectedSelectionId: z.uuid().nullable(),
  confirmed: z.literal(true),
});
export const documentSelectionSchema = z.object({
  id: z.uuid(),
  questionId: z.uuid(),
  jobId: z.uuid(),
  fieldKey: z.string(),
  questionRevision: z.number().int().positive(),
  definitionHash: hash,
  resumeId: z.uuid(),
  variantId: z.uuid().nullable(),
  artifactRevision: hash,
  pdfSha256: hash,
  sizeBytes: z.number().int().positive(),
  confirmedAt: z.date(),
  current: z.boolean(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  pdfUrl: z.string(),
});
const documentField = z.object({
  questionId: z.uuid(),
  fieldKey: z.string(),
  purpose: z.enum(["resume", "unsupported"]),
  reason: z.string().nullable(),
  selection: documentSelectionSchema.nullable(),
});
export const applicationPreparationSchema = z.object({
  job: jobQuestionsSchema.shape.job,
  collectionVersion: z.number().int().min(0),
  coverage: z.enum(QUESTION_COVERAGES).nullable(),
  manifestHash: hash,
  mode: z.enum(PREPARATION_MODES),
  questions: z.array(applicationQuestionSchema).max(200),
  documentFields: z.array(documentField).max(4000),
  submissionAllowed: z.literal(false),
});
export const preparationResultInputSchema = z
  .object({
    requestId: z.uuid(),
    expectedCollectionVersion: z.number().int().positive(),
    manifestHash: hash,
    mode: z.enum(PREPARATION_MODES).default("preview"),
    sourceUrl: z.url().max(4000),
    adapterVersion: z.string().min(1).max(80),
    status: z.enum(PREPARATION_STATUSES),
    fields: z
      .array(
        z.object({
          questionId: z.uuid(),
          fieldKey: z.string().min(1).max(200),
          status: z.enum(["verified", "omitted", "blocked", "mismatch"]),
          value: questionAnswerValuesSchema.element.shape.value.optional(),
          pdfSha256: hash.optional(),
          reason: z.string().max(1000).optional(),
        }),
      )
      .max(4000),
    reason: z.string().max(1000).optional(),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_000_000,
    "Preparation evidence exceeds the one-megabyte limit.",
  );
export const preparationResultSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  requestId: z.uuid(),
  collectionVersion: z.number().int().positive(),
  manifestHash: hash,
  mode: z.enum(PREPARATION_MODES),
  status: z.enum(PREPARATION_STATUSES),
  verification: z.literal("observed"),
  createdAt: z.date(),
  submissionAllowed: z.literal(false),
});
export type SelectQuestionDocument = z.infer<typeof selectQuestionDocumentSchema>;
export type DocumentSelection = z.infer<typeof documentSelectionSchema>;
export type ApplicationPreparation = z.infer<typeof applicationPreparationSchema>;
export type PreparationQuery = z.infer<typeof preparationQuerySchema>;
export type PreparationResultInput = z.infer<typeof preparationResultInputSchema>;
