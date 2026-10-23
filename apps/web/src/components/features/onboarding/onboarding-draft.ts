import {
  jobPreferencesSchema,
  type UserWithAutoApplyInput,
  userWithAutoApplySchema,
} from "@openapply/contracts/user";
import { z } from "zod/v4";
import { normalizeProfileDraft } from "./normalize-profile-draft";

// Drafts validate data types, not completeness: an unfinished email, phone,
// reference or compensation range must survive navigation and validation errors.
const text = z.string().optional().nullable();
const valuesSchema = userWithAutoApplySchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  preferredName: text,
  namePronunciation: text,
  pronouns: text,
  currentCompany: text,
  contactEmail: z.string(),
  phone: text,
  website: text,
  linkedin: text,
  github: text,
  portfolio: text,
  additionalLinks: z.array(z.string()).optional(),
  zipCode: text,
  jobPreferences: jobPreferencesSchema
    .extend({ yearsExperience: z.number().nullable() })
    .optional(),
  workAuthorization: z
    .array(
      z.object({
        country: z.string(),
        authorized: z.boolean().nullable(),
        sponsorship: z.boolean().nullable(),
      }),
    )
    .optional(),
  references: z.array(
    z.object({
      name: z.string(),
      relationship: text,
      company: text,
      email: text,
      phone: text,
    }),
  ),
  salaryPreferences: z.array(
    z.object({
      appliesTo: z.string(),
      minAmount: z.number().nullable().optional(),
      maxAmount: z.number().nullable().optional(),
      currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "INR"]),
      period: z.enum(["yearly", "hourly"]),
    }),
  ),
  autoApply: z
    .object({
      minMatchScore: z.number().nullable(),
      maxApplicationsPerCampaign: z.number().nullable().optional(),
      defaultStartDate: z.string(),
    })
    .optional(),
});

const currentDraftSchema = z.object({
  userId: z.string(),
  step: z.number().int().min(0).max(4),
  version: z.literal(4),
  values: valuesSchema,
});

function draftKey(userId: string): string {
  return `openapply:onboarding:v1:${userId}`;
}

export function readOnboardingDraft(storage: Pick<Storage, "getItem">, userId: string) {
  const raw = storage.getItem(draftKey(userId));
  if (!raw) return null;
  const parsed = currentDraftSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.userId !== userId) {
    throw new Error("Could not restore the onboarding draft");
  }
  // Number inputs use null for a cleared field even when the submit contract
  // requires a number. Preserve that draft value; the submit schema still
  // validates it before anything can be sent to the profile API.
  return {
    ...parsed.data,
    values: normalizeProfileDraft(parsed.data.values as UserWithAutoApplyInput),
  };
}

export function migrateOnboardingDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
): void {
  const key = draftKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return;
  const source = z
    .object({
      version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      userId: z.string(),
      step: z.number().int().min(0).max(5),
      values: z.record(z.string(), z.unknown()),
    })
    .parse(JSON.parse(raw));
  if (source.userId !== userId) throw new Error("Could not migrate another account's draft");
  if (source.version === 4) return;
  const values = { ...source.values };
  if (source.version < 3 && values.jobPreferences !== undefined) {
    const preferences = z.record(z.string(), z.unknown()).parse(values.jobPreferences);
    values.jobPreferences = { ...preferences, roles: preferences.roles ?? [] };
  }
  // Version 1 already began with Resume; versions 2–3 put agent setup first.
  let step = Math.max(0, source.step - 1);
  if (source.version === 1) step = Math.min(source.step, 4);
  const migrated = currentDraftSchema.parse({ version: 4, userId, step, values });
  storage.setItem(key, JSON.stringify(migrated));
}

export function writeOnboardingDraft(
  storage: Pick<Storage, "setItem">,
  userId: string,
  values: UserWithAutoApplyInput,
  step: number,
): void {
  storage.setItem(draftKey(userId), JSON.stringify({ version: 4, userId, values, step }));
}

export function clearOnboardingDraft(storage: Pick<Storage, "removeItem">, userId: string): void {
  storage.removeItem(draftKey(userId));
}
