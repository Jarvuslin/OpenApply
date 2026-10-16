import {
  USER_DEFAULT_VALUES,
  type UserWithAutoApplyInput,
  userWithAutoApplySchema,
} from "@openapply/contracts/user";
import type { UserAggregateResponse } from "@/api/types";
import { normalizeProfileDraft } from "@/components/features/onboarding/normalize-profile-draft";

export async function saveProfileSettings<T>(
  values: UserWithAutoApplyInput,
  readPrimary: () => Promise<string | null>,
  write: (input: UserWithAutoApplyInput) => Promise<T>,
): Promise<T> {
  // Auto-apply defaults are edited in Queue settings; a stale profile tab must not overwrite them.
  const { autoApply: _, ...input } = userWithAutoApplySchema.parse(values);
  // The current API treats an omitted primary as null; preserve the latest saved selection.
  input.primaryResumeId = await readPrimary();
  return write(input);
}

export function toFormValues(data: UserAggregateResponse): UserWithAutoApplyInput {
  const p = data.user;
  const a = data.autoApply ?? USER_DEFAULT_VALUES.autoApply!;
  return normalizeProfileDraft({
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName ?? "",
    namePronunciation: p.namePronunciation ?? "",
    pronouns: p.pronouns ?? "",
    currentCompany: p.currentCompany ?? "",
    contactEmail: p.contactEmail,
    phone: p.phone ?? "",
    website: p.website ?? "",
    linkedin: p.linkedin ?? "",
    github: p.github ?? "",
    portfolio: p.portfolio ?? "",
    additionalLinks: p.additionalLinks,
    street: p.street ?? "",
    aptUnit: p.aptUnit ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zipCode: p.zipCode ?? "",
    country: p.country ?? "",
    gpa: p.gpa,
    gpaScale: p.gpaScale,
    applicationAnswers: p.applicationAnswers,
    educationHistory: p.educationHistory,
    workHistory: p.workHistory,
    jobPreferences: p.jobPreferences,
    workAuthorization: p.workAuthorization,
    usAuthorized: p.usAuthorized,
    requiresSponsorship: p.requiresSponsorship,
    visaStatus: p.visaStatus ?? "",
    optExtension: p.optExtension ?? "",
    willingToRelocate: p.willingToRelocate,
    preferredLocations: p.preferredLocations,
    references: p.references.map((r) => ({
      name: r.name,
      relationship: r.relationship ?? "",
      company: r.company ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
    })),
    salaryPreferences: p.salaryPreferences.map((s) => ({
      appliesTo: s.appliesTo,
      minAmount: s.minAmount ?? undefined,
      maxAmount: s.maxAmount ?? undefined,
      currency: s.currency,
      period: s.period,
    })),
    eeoGender: p.eeoGender ?? "",
    eeoRace: p.eeoRace ?? "",
    eeoEthnicity: p.eeoEthnicity ?? "",
    eeoHispanicOrLatino: p.eeoHispanicOrLatino ?? "",
    eeoVeteranStatus: p.eeoVeteranStatus ?? "",
    eeoDisabilityStatus: p.eeoDisabilityStatus ?? "",
    primaryResumeId: p.primaryResumeId,
    autoApply: a,
  });
}
