import {
  FIT_RUBRIC_VERSION,
  type FitContext,
  type ScoreAssessmentInput,
} from "@openapply/contracts/scoring";
import { sha256 } from "@/common/crypto/hash";
import { jobCriteria } from "./criteria";

export const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
export const RESUME_ID = "33333333-3333-4333-8333-333333333333";
export const JOB_KEY = "example-role";
export const ORIGINAL_TEXT =
  "Original applicant\nBuilt typed web applications and tested them with integration tests.\nMaintained service endpoints and reviewed code with teammates.";
export const DESCRIPTION =
  "About us\nWe build useful software for small organizations and support our customers with a collaborative product development team.\nRequirements\nYou have experience developing typed web applications and writing integration tests.\nResponsibilities\nDevelop service endpoints and review code with your teammates to maintain reliable customer applications.";

export function scoringContext(): FitContext {
  return {
    basis: {
      version: FIT_RUBRIC_VERSION,
      resumeId: RESUME_ID,
      sourceSha256: sha256(ORIGINAL_TEXT),
      sourceTextSha256: sha256(ORIGINAL_TEXT),
      jobSha256: sha256(DESCRIPTION),
      preferencesSha256: sha256("preferences"),
    },
    job: {
      title: "Frontend Engineer",
      company: "Example",
      url: "https://employer.test/job",
      location: "Toronto",
      type: "Full-time",
      description: DESCRIPTION,
      criteria: jobCriteria(DESCRIPTION, "Frontend Engineer", "Example"),
    },
    resume: { text: ORIGINAL_TEXT },
    preferences: {
      jobPreferences: {
        roles: ["Software engineering"],
        levels: ["Entry"],
        yearsExperience: null,
        workModes: ["Hybrid"],
        employmentTypes: ["Full-time"],
      },
      preferredLocations: ["Toronto"],
      workAuthorization: [{ country: "Canada", authorized: true, sponsorship: false }],
    },
    minMatchScore: 60,
    cachedAssessment: null,
  };
}

export function scoringInput(context = scoringContext()): ScoreAssessmentInput {
  const quote = "Built typed web applications and tested them with integration tests.";
  const start = context.resume.text.indexOf(quote);
  return {
    campaignId: CAMPAIGN_ID,
    jobKey: JOB_KEY,
    basis: context.basis,
    assessments: context.job.criteria.map((criterion) => {
      let category: ScoreAssessmentInput["assessments"][number]["category"] = "context";
      if (!criterion.isHeading && criterion.section === "requirements") category = "requirement";
      if (!criterion.isHeading && criterion.section === "responsibilities")
        category = "responsibility";
      return {
        criterionId: criterion.id,
        category,
        rating: category === "context" ? "not_applicable" : "strong",
        evidence: category === "context" ? [] : [{ start, end: start + quote.length, quote }],
        explanation:
          category === "context"
            ? "This is a heading or company background, not an applicant criterion."
            : "The original resume describes comparable application work and testing.",
      };
    }),
    roleMatch: {
      family: "Frontend",
      evidence: [
        { source: "title", start: 0, end: context.job.title.length, quote: context.job.title },
      ],
      explanation: "The posting is a frontend engineering role.",
    },
  };
}
