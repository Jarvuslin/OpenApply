import type { ResumeBasics, ResumeData } from "@openapply/contracts/resume";
import {
  type EducationEntryInput,
  educationEntrySchema,
  type UserWithAutoApplyInput,
  type WorkEntryInput,
  workEntrySchema,
} from "@openapply/contracts/user";
import { applyBasicsToForm } from "@/components/features/onboarding/map-basics-to-profile";

const labels = {
  firstName: "First name",
  lastName: "Last name",
  contactEmail: "Contact email",
  phone: "Phone",
  website: "Website",
  linkedin: "LinkedIn",
  github: "GitHub",
  city: "City",
  state: "Province / state",
  country: "Country",
};

export interface ResumeProfileChange {
  field: keyof typeof labels;
  label: string;
  value: string;
}

export function resumeProfileChanges(
  profile: UserWithAutoApplyInput,
  basics: ResumeBasics,
): ResumeProfileChange[] {
  const draft = { ...profile };
  const changes: ResumeProfileChange[] = [];
  applyBasicsToForm(
    {
      getFieldValue: (field) => draft[field],
      setFieldValue: (field, value) => {
        draft[field] = value;
        changes.push({ field, label: labels[field], value });
      },
    },
    basics,
  );
  return changes;
}

const MAX_TEXT = 120;
const MAX_SUMMARY = 600;
const clip = (text: string | undefined, max = MAX_TEXT) => {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Jobs and schools on the resume that the profile does not list yet, in resume order. */
export function resumeHistoryAdditions(
  profile: UserWithAutoApplyInput,
  content: Pick<ResumeData, "experience" | "education">,
): { jobs: WorkEntryInput[]; schools: EducationEntryInput[] } {
  const savedJobs = profile.workHistory ?? [];
  const savedSchools = profile.educationHistory ?? [];
  const jobs = content.experience
    .filter(
      (job) =>
        !savedJobs.some(
          (saved) => sameText(saved.company, job.company) && sameText(saved.title, job.title),
        ),
    )
    .map((job) =>
      workEntrySchema.safeParse({
        company: clip(job.company),
        title: clip(job.title),
        location: clip(job.location),
        start: clip(job.start),
        // A current role is stored with a blank end.
        end: /^(present|current|now)$/i.test(job.end?.trim() ?? "") ? "" : clip(job.end),
        summary: clip(job.bullets.slice(0, 2).join(" "), MAX_SUMMARY),
      }),
    )
    .flatMap((result) => (result.success ? [result.data] : []));
  const schools = content.education
    .filter((school) => !savedSchools.some((saved) => sameText(saved.school, school.school)))
    .map((school) =>
      educationEntrySchema.safeParse({
        school: clip(school.school),
        degree: clip(school.degree),
        field: "",
        start: clip(school.start),
        end: clip(school.end),
      }),
    )
    .flatMap((result) => (result.success ? [result.data] : []));
  return { jobs, schools };
}
