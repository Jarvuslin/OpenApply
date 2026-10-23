import { z } from "zod/v4";
import { BANK_REVISION_ACTIONS, BANK_SCOPES } from "./answer-bank-input";
import {
  QUESTION_CATEGORIES,
  type QuestionDefinition,
  questionAnswerValuesSchema,
  questionDefinitionSchema,
} from "./application-question";
import { paginatedSchema, paginationQuerySchema } from "./pagination";

export const bankEntrySchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  revision: z.number().int().positive(),
  action: z.enum(BANK_REVISION_ACTIONS),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  scope: z.enum(BANK_SCOPES),
  category: z.enum(QUESTION_CATEGORIES),
  countryCode: z.string().nullable(),
  employerKey: z.string().nullable(),
  roleKey: z.string().nullable(),
  sourceAnswerId: z.uuid().nullable(),
  sourceQuestionId: z.uuid(),
  sourceJobId: z.uuid(),
  sourceDefinition: questionDefinitionSchema,
  sourceValues: questionAnswerValuesSchema,
  sourceConfirmedAt: z.date(),
  consentedAt: z.date(),
  createdAt: z.date(),
  requiresConfirmation: z.literal(true),
});
export const bankListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["all", "active", "revoked"]).default("active"),
});
export const bankListSchema = paginatedSchema(bankEntrySchema);
export const bankHistorySchema = z.object({
  entry: bankEntrySchema,
  revisions: paginatedSchema(bankEntrySchema),
});
const matchSchema = z.object({
  entryId: z.uuid(),
  revision: z.number().int().positive(),
  mappedValues: questionAnswerValuesSchema,
  scope: z.enum(BANK_SCOPES),
  countryCode: z.string().nullable(),
  employerKey: z.string().nullable(),
  roleKey: z.string().nullable(),
  sourceConfirmedAt: z.date(),
  sourceQuestionId: z.uuid(),
  sourceJobId: z.uuid(),
  requiresConfirmation: z.literal(true),
});
export const answerMatchesSchema = z.object({
  status: z.enum(["matched", "none", "ambiguous", "unavailable"]),
  reason: z.string().nullable(),
  matches: z.array(matchSchema).max(20),
});
export type BankScope = (typeof BANK_SCOPES)[number];
export type QuestionAnswerValues = z.infer<typeof questionAnswerValuesSchema>;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export interface BankQuestionContext {
  countryCode: string | null;
  countryConfirmed: boolean;
  company: string | null;
  jobTitle: string | null;
}
export interface BankSourceCandidate {
  definition: QuestionDefinition;
  category: QuestionCategory;
  values: QuestionAnswerValues;
  countryCode: string | null;
  employerKey: string | null;
  roleKey: string | null;
}
export interface BankTargetQuestion extends BankQuestionContext {
  definition: QuestionDefinition;
  category: QuestionCategory;
}
export type BankEntry = z.infer<typeof bankEntrySchema>;
export type BankListQuery = z.infer<typeof bankListQuerySchema>;
export type AnswerMatches = z.infer<typeof answerMatchesSchema>;
