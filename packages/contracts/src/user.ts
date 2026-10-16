import { z } from "zod/v4";
import { optionalPhoneSchema } from "./phone";

const optionalUrl = z
  .union([z.literal(""), z.url("Must be a valid URL")])
  .optional()
  .nullable();

const applicantLinkSchema = z
  .url("Must be a valid URL")
  .refine((value) => /^https?:\/\//i.test(value), "Use an http:// or https:// link");
const optionalApplicantLink = z
  .union([z.literal(""), applicantLinkSchema])
  .optional()
  .nullable();
const optionalApplicantText = z.string().trim().max(200).optional().nullable();
export const additionalLinksSchema = z.array(applicantLinkSchema).max(10);

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
export const ROLE_FAMILIES = [
  "Software engineering",
  "Frontend",
  "Backend",
  "Full stack",
  "Mobile",
  "Data engineering",
  "DevOps / platform",
  "QA / test",
  "Security",
] as const;
export const jobPreferencesSchema = z.object({
  roles: z.array(z.enum(ROLE_FAMILIES)).max(ROLE_FAMILIES.length),
  levels: z.array(z.enum(JOB_LEVELS)),
  yearsExperience: z.number().min(0).max(80).nullable(),
  workModes: z.array(z.enum(WORK_MODES)),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
});
export const workAuthorizationSchema = z
  .array(
    z.object({
      country: z.string().min(1, "Choose a country"),
      authorized: z.boolean().nullable(),
      sponsorship: z.boolean().nullable(),
    }),
  )
  .max(20);

const historyText = z.string().trim().max(120);

/** A school the user attended; dates are free text like "Sep 2022" or "May 2026". */
export const educationEntrySchema = z.object({
  school: historyText.min(1, "Required"),
  degree: historyText,
  field: historyText,
  start: historyText,
  end: historyText,
});
export type EducationEntryInput = z.infer<typeof educationEntrySchema>;

/** A job the user held; a blank end means it is current. */
export const workEntrySchema = z.object({
  company: historyText.min(1, "Required"),
  title: historyText.min(1, "Required"),
  location: historyText,
  start: historyText,
  end: historyText,
  summary: z.string().trim().max(600),
});
export type WorkEntryInput = z.infer<typeof workEntrySchema>;

const answerText = z.string().trim().max(200).optional();

/** Answers to questions most application forms ask; a blank one goes to Needs you once. */
export const applicationAnswersSchema = z.object({
  legalAge: answerText,
  basicQualifications: answerText,
  unixLinux: answerText,
  securityClearance: answerText,
  graduationDate: answerText,
  languages: answerText,
  heardAbout: answerText,
  referredByEmployee: answerText,
  workedHereBefore: answerText,
  relativesAtCompany: answerText,
  conflictOfInterest: answerText,
  secondJob: answerText,
  criminalConviction: answerText,
  backgroundCheck: answerText,
  drugScreening: answerText,
  nonCompete: answerText,
  phoneType: answerText,
  textMessages: answerText,
  travel: answerText,
});
export type ApplicationAnswers = z.infer<typeof applicationAnswersSchema>;

const YES_NO = ["Yes", "No"] as const;

/** How each answer is asked and shown. `choices` null means free text. */
export const APPLICATION_QUESTIONS: readonly {
  key: keyof ApplicationAnswers;
  // Contact answers are edited beside the phone number, not in the answers tab.
  group: "Screening" | "About this employer" | "Checks and agreements" | "Logistics" | "Contact";
  label: string;
  choices: readonly string[] | null;
  placeholder?: string;
}[] = [
  { key: "legalAge", group: "Screening", label: "18 or older", choices: YES_NO },
  {
    key: "basicQualifications",
    group: "Screening",
    label: "Meets the basic qualifications",
    choices: YES_NO,
  },
  { key: "unixLinux", group: "Screening", label: "Unix / Linux experience", choices: YES_NO },
  {
    key: "securityClearance",
    group: "Screening",
    label: "Security clearance",
    choices: null,
    placeholder: "None",
  },
  {
    key: "graduationDate",
    group: "Screening",
    label: "Graduation date",
    choices: null,
    placeholder: "May 2026",
  },
  {
    key: "languages",
    group: "Screening",
    label: "Languages",
    choices: null,
    placeholder: "English (native), French (conversational)",
  },
  {
    key: "heardAbout",
    group: "About this employer",
    label: "How did you hear about us",
    choices: null,
    placeholder: "Company careers page",
  },
  {
    key: "referredByEmployee",
    group: "About this employer",
    label: "Referred by an employee",
    choices: YES_NO,
  },
  {
    key: "workedHereBefore",
    group: "About this employer",
    label: "Worked here before",
    choices: YES_NO,
  },
  {
    key: "relativesAtCompany",
    group: "About this employer",
    label: "Relatives working there",
    choices: YES_NO,
  },
  {
    key: "conflictOfInterest",
    group: "About this employer",
    label: "Conflict of interest or ties to officials",
    choices: YES_NO,
  },
  {
    key: "secondJob",
    group: "About this employer",
    label: "Second job or outside business",
    choices: YES_NO,
  },
  {
    key: "criminalConviction",
    group: "Checks and agreements",
    label: "Criminal conviction",
    choices: YES_NO,
  },
  {
    key: "backgroundCheck",
    group: "Checks and agreements",
    label: "Willing to take a background check",
    choices: YES_NO,
  },
  {
    key: "drugScreening",
    group: "Checks and agreements",
    label: "Willing to take a drug screening",
    choices: YES_NO,
  },
  {
    key: "nonCompete",
    group: "Checks and agreements",
    label: "Signed a non-compete or non-solicit",
    choices: YES_NO,
  },
  {
    key: "phoneType",
    group: "Contact",
    label: "Phone type",
    choices: ["Mobile", "Home", "Work"],
  },
  { key: "textMessages", group: "Logistics", label: "Text message updates", choices: YES_NO },
  {
    key: "travel",
    group: "Logistics",
    label: "Willing to travel",
    choices: ["None", "Up to 25%", "Up to 50%", "Up to 75%", "Any amount"],
  },
];

const userUpdateSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  preferredName: optionalApplicantText,
  namePronunciation: optionalApplicantText,
  pronouns: optionalApplicantText,
  currentCompany: optionalApplicantText,
  contactEmail: z.email(),
  phone: optionalPhoneSchema,
  website: optionalUrl,
  linkedin: optionalLinkedinUrl,
  github: optionalGithubUrl,
  portfolio: optionalApplicantLink,
  additionalLinks: additionalLinksSchema.optional(),

  street: z.string().optional().nullable(),
  aptUnit: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: optionalZipCode,
  country: z.string().optional().nullable(),
  gpa: z.number().min(0).max(10).nullable().optional(),
  gpaScale: z.number().min(1).max(10).nullable().optional(),
  applicationAnswers: applicationAnswersSchema.optional(),
  educationHistory: z.array(educationEntrySchema).max(10).optional(),
  workHistory: z.array(workEntrySchema).max(20).optional(),
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

export const autoApplySettingsSchema = z.object({
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
export type AutoApplySettingsInput = z.infer<typeof autoApplySettingsSchema>;

export const USER_DEFAULT_VALUES: UserWithAutoApplyInput = {
  firstName: "",
  lastName: "",
  preferredName: "",
  namePronunciation: "",
  pronouns: "",
  currentCompany: "",
  contactEmail: "",
  phone: "",
  website: "",
  linkedin: "",
  github: "",
  portfolio: "",
  additionalLinks: [],
  street: "",
  aptUnit: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  gpa: null,
  gpaScale: 4,
  jobPreferences: {
    roles: [],
    levels: [],
    yearsExperience: null,
    workModes: [],
    employmentTypes: [],
  },
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
  applicationAnswers: {},
  educationHistory: [],
  workHistory: [],
  autoApply: {
    minMatchScore: DEFAULT_MIN_MATCH_SCORE,
    maxApplicationsPerCampaign: null,
    defaultStartDate: "",
  },
};

/** The /u/[username] slug. Lowercased; letters, digits, and interior hyphens only. */

export const AVAILABILITY = ["open", "not_looking"] as const;
export const availabilitySchema = z.enum(AVAILABILITY);

/** What the owner has chosen to publish; every flag is opt-in. */
