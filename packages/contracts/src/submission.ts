import { z } from "zod/v4";
import { applicationSourceSchema } from "./application";
import { PILOT_QUESTION_KINDS } from "./pilot/question";

const httpUrlSchema = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Expected an HTTP URL")
  .transform((value) => {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|auth|code|secret|password|session|key|signature|credential/i.test(key))
        url.searchParams.delete(key);
    }
    return url.toString();
  });
const secretField =
  /password|passwd|passphrase|passcode|\botp\b|one.?time|verification.?code|security.?answer|credential|secret|token|api.?key|\bpin\b|\bssn\b|\bsin\b|social.?insurance|social.?security/i;

export const submissionFieldSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(500),
    type: z.string().trim().min(1).max(80),
    section: z.string().trim().max(200).optional(),
    value: z.union([
      z.string().max(20000),
      z.array(z.string().max(2000)).max(100),
      z.boolean(),
      z.null(),
    ]),
    redacted: z.boolean().optional(),
  })
  .transform((field) => {
    const sensitive =
      field.redacted ||
      field.type.toLowerCase() === "hidden" ||
      secretField.test(
        `${field.id} ${field.label} ${field.type} ${field.section ?? ""}`
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/[_-]/g, " "),
      );
    return sensitive ? { ...field, value: null, redacted: true } : field;
  });

export const submittedResumeSchema = z.object({
  jobId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[\\/\r\n"]/.test(value), "Expected a filename"),
  artifact: z
    .object({
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      resumeId: z.uuid(),
      variantId: z.uuid().optional(),
    })
    .optional(),
});

export const applicationSubmissionSchema = z.object({
  version: z.literal(1),
  fields: z
    .array(submissionFieldSchema)
    .min(1)
    .max(500)
    .refine(
      (fields) => new Set(fields.map((field) => field.id)).size === fields.length,
      "Field ids must be unique across form sections",
    )
    .refine(
      (fields) => JSON.stringify(fields).length <= 200000,
      "Captured fields must be at most 200,000 characters",
    ),
  confirmation: z.object({
    url: httpUrlSchema,
    text: z.string().trim().min(1).max(10000),
    observedAt: z.iso.datetime(),
    reference: z.string().trim().max(500).optional(),
  }),
  resume: submittedResumeSchema,
});

export const applicationSubmissionRecordSchema = applicationSubmissionSchema.extend({
  previous: z.array(applicationSubmissionSchema).default([]),
});

export type ApplicationSubmission = z.infer<typeof applicationSubmissionSchema>;
export type SubmittedResume = z.infer<typeof submittedResumeSchema>;

export const submissionCheckpointInputSchema = z.strictObject({
  expectedCheckpointId: z.uuid().optional(),
  fields: applicationSubmissionSchema.shape.fields,
  resume: submittedResumeSchema,
  resumeId: z.uuid(),
  resumeVariantId: z.uuid().optional(),
  formUrl: httpUrlSchema.optional(),
  review: z.object({
    reviewedAt: z.iso.datetime(),
    summary: z.string().trim().min(1).max(4000),
    checks: z.object({
      job: z.literal(true),
      fields: z.literal(true),
      resume: z.literal(true),
      factualClaims: z.literal(true),
    }),
    issues: z.array(z.string()).max(0),
  }),
});

export const submissionCheckpointSchema = submissionCheckpointInputSchema
  .omit({ expectedCheckpointId: true })
  .extend({
    job: z.object({
      id: z.uuid(),
      campaignId: z.uuid(),
      key: z.string(),
      url: z.string(),
      canonicalUrl: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      board: z.string().nullable(),
      source: applicationSourceSchema,
      matchScore: z.number().int().nullable(),
      matchReason: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    }),
  });

export const submissionBeginInputSchema = z.strictObject({ checkpointId: z.uuid() });
export const submissionReceiptInputSchema = submissionBeginInputSchema.extend({
  confirmation: applicationSubmissionSchema.shape.confirmation,
});

const submissionAttemptViewSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid().nullable(),
  originalUrl: z.string(),
  canonicalUrl: z.string(),
  state: z.enum(["prepared", "unknown", "recording_pending", "recorded"]),
  legacyOutcomeUnknown: z.boolean(),
  checkpointId: z.uuid().nullable(),
  checkpoint: submissionCheckpointSchema.nullable(),
  startedAt: z.date().nullable(),
  receipt: submissionReceiptInputSchema.nullable(),
  receiptStoredAt: z.date().nullable(),
  recordedAt: z.date().nullable(),
  applicationId: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const submissionAttemptResponseSchema = z.object({
  attempt: submissionAttemptViewSchema.nullable(),
});
export const submissionBeginResponseSchema = z.object({
  began: z.boolean(),
  attempt: submissionAttemptViewSchema,
});
export type SubmissionCheckpointInput = z.infer<typeof submissionCheckpointInputSchema>;
export type SubmissionReceiptInput = z.infer<typeof submissionReceiptInputSchema>;
export type SubmissionAttemptView = z.infer<typeof submissionAttemptViewSchema>;

const observationsSchema = z.array(z.string().trim().min(1).max(2000)).max(20).optional();
export const submissionWorkerResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("recorded"),
    applicationId: z.uuid(),
    checkpointId: z.uuid(),
    observations: observationsSchema,
  }),
  z.strictObject({
    outcome: z.literal("recording_pending"),
    checkpointId: z.uuid(),
    context: z.string().trim().min(1).max(4000),
    recoveryFile: z.string().max(2000).optional(),
    observations: observationsSchema,
  }),
  z.strictObject({
    outcome: z.literal("needs_user"),
    category: z.string().trim().min(1).max(100),
    context: z.string().max(4000).optional(),
    kind: z.enum(PILOT_QUESTION_KINDS),
    question: z.string().trim().min(1).max(4000),
    options: z.array(z.string().max(1000)).max(20).optional(),
    observations: observationsSchema,
  }),
  z.strictObject({
    outcome: z.literal("failed"),
    failReason: z.string().trim().min(1).max(4000),
    retryNotes: z.string().max(4000).optional(),
    observations: observationsSchema,
  }),
  z.strictObject({
    outcome: z.literal("skipped"),
    skipReason: z.string().trim().min(1).max(4000),
    observations: observationsSchema,
  }),
]);
export const submissionWorkerCheckResponseSchema = z.object({
  valid: z.literal(true),
  outcome: z.enum(["recorded", "recording_pending", "needs_user", "failed", "skipped"]),
  attempt: submissionAttemptViewSchema.nullable(),
});
export type SubmissionWorkerResult = z.infer<typeof submissionWorkerResultSchema>;
