import { type UserWithAutoApplyInput, userWithAutoApplySchema } from "@jobpilot/contracts/user";
import { z } from "zod/v4";

// Drafts validate data types, not completeness: an unfinished email, phone,
// reference or compensation range must survive navigation and validation errors.
const text = z.string().optional().nullable();
const valuesSchema = userWithAutoApplySchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  contactEmail: z.string(),
  phone: text,
  website: text,
  linkedin: text,
  github: text,
  zipCode: text,
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

const draftSchema = z.object({
  version: z.literal(1),
  userId: z.string(),
  step: z.number().int().min(0).max(5),
  values: valuesSchema,
});

function draftKey(userId: string): string {
  return `jobpilot:onboarding:v1:${userId}`;
}

export function readOnboardingDraft(storage: Pick<Storage, "getItem">, userId: string) {
  const raw = storage.getItem(draftKey(userId));
  if (!raw) return null;
  const parsed = draftSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.userId !== userId) {
    throw new Error("Could not restore the onboarding draft");
  }
  // Number inputs use null for a cleared field even when the submit contract
  // requires a number. Preserve that draft value; the submit schema still
  // validates it before anything can be sent to the profile API.
  return { ...parsed.data, values: parsed.data.values as UserWithAutoApplyInput };
}

export function writeOnboardingDraft(
  storage: Pick<Storage, "setItem">,
  userId: string,
  values: UserWithAutoApplyInput,
  step: number,
): void {
  storage.setItem(draftKey(userId), JSON.stringify({ version: 1, userId, values, step }));
}
