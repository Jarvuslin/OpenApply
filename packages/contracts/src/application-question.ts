import { z } from "zod/v4";
import { saveToProfileSchema, useSavedAnswerSchema } from "./answer-bank-input";
import { paginatedSchema, paginationQuerySchema } from "./pagination";
import { pilotQuestionSchema } from "./pilot/question";

export const QUESTION_SOURCES = [
  "greenhouse_public",
  "public_probe",
  "browser_dom",
  "legacy",
] as const;
export const QUESTION_COVERAGES = ["complete", "partial", "requires_browser", "blocked"] as const;
export const QUESTION_CATEGORIES = [
  "authorization",
  "sponsorship",
  "demographic",
  "disability",
  "veteran",
  "contact",
  "document",
  "other",
] as const;
export const QUESTION_REQUIREMENTS = ["required", "optional", "unknown"] as const;
export const QUESTION_VISIBILITIES = ["visible", "hidden", "unknown"] as const;
export const QUESTION_AUTHORSHIPS = [
  "session_user",
  "telegram_user",
  "agent",
  "migration",
] as const;

export const jobQuestionParams = z.object({ slug: z.uuid() });
const key = z.string().min(1).max(200);
const option = z.object({
  value: z.string().max(2000),
  label: z.string().max(2000),
  freeText: z.enum(["none", "optional", "required_when_alone", "unknown"]).optional(),
});
const field = z.object({
  key,
  label: z.string().max(4000).optional(),
  type: z.enum([
    "text",
    "email",
    "phone",
    "number",
    "date",
    "single_choice",
    "multi_choice",
    "boolean",
    "file",
    "unknown",
  ]),
  options: z.array(option).max(200).default([]),
});
export const questionDefinitionSchema = z
  .object({
    stableKey: key,
    prompt: z.string().min(1).max(4000),
    description: z.string().max(8000).optional(),
    required: z.enum(QUESTION_REQUIREMENTS),
    visibility: z.enum(QUESTION_VISIBILITIES),
    condition: z.object({
      state: z.enum(["unconditional", "known", "unknown"]),
      rules: z
        .array(
          z.object({
            fieldKey: key,
            operator: z.enum(["equals", "not_equals", "includes"]),
            values: z.array(z.string().max(2000)).min(1).max(200),
          }),
        )
        .max(20)
        .default([]),
    }),
    groupMode: z.enum(["all", "any"]),
    fields: z.array(field).min(1).max(20),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.fields.map((item) => item.key)).size !== value.fields.length)
      ctx.addIssue({ code: "custom", message: "Field keys must be unique within a question." });
    if ((value.condition.state === "known") !== value.condition.rules.length > 0)
      ctx.addIssue({
        code: "custom",
        message: "Known conditions require rules; other conditions cannot contain rules.",
      });
  });

export const questionObservationSchema = z
  .object({
    requestId: z.uuid(),
    expectedCollectionVersion: z.number().int().min(0),
    source: z.literal("browser_dom"),
    sourceUrl: z.url().max(4000),
    coverage: z.enum(["complete", "partial", "blocked"]),
    collectorVersion: z.string().min(1).max(80),
    reason: z.string().max(1000).optional(),
    definitions: z.array(questionDefinitionSchema).max(200),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_000_000,
    "Form observations exceed the one-megabyte limit.",
  );
export const questionAnswerValuesSchema = z
  .array(
    z.object({
      fieldKey: key,
      value: z.union([
        z.string().max(16000),
        z.number().finite(),
        z.boolean(),
        z.array(z.string().max(2000)).max(200),
      ]),
    }),
  )
  .min(1)
  .max(20);
export const answerApplicationQuestionSchema = z.object({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  values: questionAnswerValuesSchema,
  saveToProfile: saveToProfileSchema.optional(),
  useSavedAnswer: useSavedAnswerSchema.optional(),
});
const answer = z.object({
  id: z.uuid(),
  values: questionAnswerValuesSchema,
  confirmedAt: z.date().nullable(),
});
export const applicationQuestionSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  revision: z.number().int().positive(),
  definitionHash: z.string(),
  definition: questionDefinitionSchema,
  category: z.enum(QUESTION_CATEGORIES),
  source: z.enum(QUESTION_SOURCES),
  sourceUrl: z.string(),
  observedAt: z.date(),
  collectionId: z.uuid(),
  collectorVersion: z.string(),
  verification: z.literal("observed"),
  current: z.boolean(),
  blocking: z.boolean(),
  answer: answer.nullable(),
  createdAt: z.date(),
});
const job = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  key: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
});
const questionCollectionSchema = z.object({
  id: z.uuid(),
  source: z.enum(QUESTION_SOURCES),
  sourceUrl: z.string(),
  coverage: z.enum(QUESTION_COVERAGES),
  collectorVersion: z.string(),
  observedAt: z.date(),
  reason: z.string().nullable(),
  verification: z.literal("observed"),
});
export const jobQuestionsSchema = z.object({
  job,
  collectionVersion: z.number().int().min(0),
  latestCollection: questionCollectionSchema.nullable(),
  questions: z.array(applicationQuestionSchema),
});
export const needsYouQuerySchema = paginationQuerySchema.extend({
  target: z.uuid().optional(),
  kind: z.enum(["all", "application", "operational", "collection"]).default("all"),
});
export const needsYouListSchema = paginatedSchema(
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("application"),
      id: z.uuid(),
      job,
      question: applicationQuestionSchema,
    }),
    z.object({
      kind: z.literal("collection"),
      id: z.uuid(),
      job,
      collection: questionCollectionSchema,
    }),
    z.object({ kind: z.literal("operational"), id: z.uuid(), question: pilotQuestionSchema }),
  ]),
);
export const needsYouCountSchema = z.object({
  total: z.number().int(),
  application: z.number().int(),
  operational: z.number().int(),
  collection: z.number().int(),
});
export type QuestionDefinition = z.infer<typeof questionDefinitionSchema>;
export type QuestionObservation = z.infer<typeof questionObservationSchema>;
export type AnswerApplicationQuestion = z.infer<typeof answerApplicationQuestionSchema>;
export type ApplicationQuestionView = z.infer<typeof applicationQuestionSchema>;
export type JobQuestions = z.infer<typeof jobQuestionsSchema>;
export type NeedsYouQuery = z.infer<typeof needsYouQuerySchema>;
