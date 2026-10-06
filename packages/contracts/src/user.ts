import { z } from "zod/v4";
import { optionalPhoneSchema } from "./phone";

const optionalUrl = z
  .union([z.literal(""), z.url("Must be a valid URL")])
  .optional()
  .nullable();

const optionalZipCode = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/,
        "Enter a valid ZIP or postal code (e.g. 94103 or SW1A 1AA)",
      ),
  ])
  .optional()
  .nullable();

const optionalLinkedinUrl = z
  .union([
    z.literal(""),
    z
      .url("Must be a valid URL")
      .regex(
        /^https?:\/\/([\w-]+\.)?linkedin\.com\/(in|pub|company)\/[\w\-%.]+\/?.*$/i,
        "Must be a LinkedIn profile URL (e.g. https://linkedin.com/in/your-handle)",
      ),
  ])
  .optional()
  .nullable();

const optionalGithubUrl = z
  .union([
    z.literal(""),
    z
      .url("Must be a valid URL")
      .regex(
        /^https?:\/\/([\w-]+\.)?github\.com\/[\w\-.]+\/?.*$/i,
        "Must be a GitHub profile URL (e.g. https://github.com/your-handle)",
      ),
  ])
  .optional()
  .nullable();

const optionalEmail = z
  .union([z.literal(""), z.email()])
  .optional()
  .nullable();

const referenceSchema = z.object({
  name: z.string().min(1, "Required"),
  relationship: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  email: optionalEmail,
  phone: optionalPhoneSchema,
});

export type ReferenceInput = z.infer<typeof referenceSchema>;

export const SALARY_PERIODS = ["yearly", "hourly"] as const;

export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const SALARY_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR"] as const;

export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];

const salaryPreferenceSchema = z.object({
  appliesTo: z.string().min(1, "Required"),
  minAmount: z.number().nonnegative().optional().nullable(),
  maxAmount: z.number().nonnegative().optional().nullable(),
  currency: z.enum(SALARY_CURRENCIES),
  period: z.enum(SALARY_PERIODS),
});

export type SalaryPreferenceInput = z.infer<typeof salaryPreferenceSchema>;

export const JOB_LEVELS = [
  "Internship",
  "Entry",
  "Intermediate / Mid",
  "Senior",
  "Staff",
  "Principal",
  "Manager",
  "Director+",
] as const;
export const WORK_MODES = ["Remote", "Hybrid", "Onsite"] as const;
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;
export const jobPreferencesSchema = z.object({
  levels: z.array(z.enum(JOB_LEVELS)),
  yearsExperience: z.number().min(0).max(80).nullable(),
  workModes: z.array(z.enum(WORK_MODES)),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
});
export const workAuthorizationSchema = z
  .array(
    z.object({
      country: z.string().min(1, "Choose a country"),
      authorized: z
        .boolean()
        .nullable()
        .refine((v): boolean => v !== null, "Choose Yes or No for work authorization"),
      sponsorship: z
        .boolean()
        .nullable()
        .refine((v): boolean => v !== null, "Choose Yes or No for sponsorship"),
    }),
  )
  .max(20);

const userUpdateSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  contactEmail: z.email(),
  phone: optionalPhoneSchema,
  website: optionalUrl,
  linkedin: optionalLinkedinUrl,
  github: optionalGithubUrl,

  street: z.string().optional().nullable(),
  aptUnit: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: optionalZipCode,
  country: z.string().optional().nullable(),
  jobPreferences: jobPreferencesSchema.optional(),
  workAuthorization: workAuthorizationSchema.optional(),

  usAuthorized: z.boolean(),
  requiresSponsorship: z.boolean(),
  visaStatus: z.string().optional().nullable(),
  optExtension: z.string().optional().nullable(),
  willingToRelocate: z.boolean(),
  preferredLocations: z.array(z.string()),
  references: z.array(referenceSchema).max(3),
  salaryPreferences: z.array(salaryPreferenceSchema).max(5),

  eeoGender: z.string().optional().nullable(),
  eeoRace: z.string().optional().nullable(),
  eeoEthnicity: z.string().optional().nullable(),
  eeoHispanicOrLatino: z.string().optional().nullable(),
  eeoVeteranStatus: z.string().optional().nullable(),
  eeoDisabilityStatus: z.string().optional().nullable(),

  primaryResumeId: z.uuid().nullable().optional(),
});

/** Auto-apply threshold when the user has not set one; also the fit scorer's fallback. */
export const DEFAULT_MIN_MATCH_SCORE = 60;

const autoApplySettingsSchema = z.object({
  minMatchScore: z.number().int().min(0).max(100),
  maxApplicationsPerCampaign: z
    .number()
    .int()
    .min(0, "Choose no limit or enter 1–500 applications")
    .max(500)
    .nullable()
    .transform((v) => (v === 0 ? null : v))
    .optional(),
  defaultStartDate: z.string(),
});

export const userWithAutoApplySchema = userUpdateSchema.extend({
  autoApply: autoApplySettingsSchema.optional(),
});

/** Body for setting (or clearing, with `null`) the user's primary resume. */
export const setPrimaryResumeSchema = z.object({
  resumeId: z.uuid().nullable(),
});

export type UserWithAutoApplyInput = z.infer<typeof userWithAutoApplySchema>;

export const USER_DEFAULT_VALUES: UserWithAutoApplyInput = {
  firstName: "",
  lastName: "",
  contactEmail: "",
  phone: "",
  website: "",
  linkedin: "",
  github: "",
  street: "",
  aptUnit: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  jobPreferences: { levels: [], yearsExperience: null, workModes: [], employmentTypes: [] },
  workAuthorization: [],
  usAuthorized: false,
  requiresSponsorship: false,
  visaStatus: "",
  optExtension: "",
  willingToRelocate: false,
  preferredLocations: [],
  references: [],
  salaryPreferences: [],
  eeoGender: "Prefer not to disclose",
  eeoRace: "Prefer not to disclose",
  eeoEthnicity: "Prefer not to disclose",
  eeoHispanicOrLatino: "Prefer not to disclose",
  eeoVeteranStatus: "Prefer not to disclose",
  eeoDisabilityStatus: "Prefer not to disclose",
  primaryResumeId: null,
  autoApply: {
    minMatchScore: DEFAULT_MIN_MATCH_SCORE,
    maxApplicationsPerCampaign: null,
    defaultStartDate: "2 weeks notice",
  },
};

/** The /u/[username] slug. Lowercased; letters, digits, and interior hyphens only. */

export const AVAILABILITY = ["open", "not_looking"] as const;
export const availabilitySchema = z.enum(AVAILABILITY);

/** What the owner has chosen to publish; every flag is opt-in. */
