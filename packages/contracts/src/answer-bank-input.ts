import { z } from "zod/v4";

export const BANK_SCOPES = ["account", "employer"] as const;
export const BANK_REVISION_ACTIONS = ["save", "revoke"] as const;
export const BANK_SENSITIVE_CATEGORIES = [
  "authorization",
  "sponsorship",
  "demographic",
  "disability",
  "veteran",
] as const;
// Unclassified wording can still ask for sensitive facts; contact is the only country-free category.
export const BANK_COUNTRY_REQUIRED_CATEGORIES = [...BANK_SENSITIVE_CATEGORIES, "other"] as const;
const countryContext = {
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  countryConfirmed: z.literal(true).optional(),
};
const bankReference = z.object({ entryId: z.uuid(), revision: z.number().int().positive() });
export const saveToProfileSchema = z.object({
  consent: z.literal(true),
  scope: z.enum(BANK_SCOPES),
  ...countryContext,
  expectedBank: bankReference.optional(),
});
export const useSavedAnswerSchema = bankReference.extend(countryContext);
export const answerMatchesInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  ...countryContext,
});
export const revokeBankEntrySchema = z.object({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
export const reviseBankEntrySchema = revokeBankEntrySchema.extend({
  sourceAnswerId: z.uuid(),
  consent: z.literal(true),
  countryConfirmed: z.literal(true).optional(),
});
export type SaveToProfile = z.infer<typeof saveToProfileSchema>;
export type UseSavedAnswer = z.infer<typeof useSavedAnswerSchema>;
export type AnswerMatchesInput = z.infer<typeof answerMatchesInputSchema>;
export type RevokeBankEntry = z.infer<typeof revokeBankEntrySchema>;
export type ReviseBankEntry = z.infer<typeof reviseBankEntrySchema>;
