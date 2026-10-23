import { fitAssessmentSchema, type ScoreAssessmentInput } from "@openapply/contracts/scoring";
import { assessFit } from "./assessment";
import { scoringContext, scoringInput } from "./fakes";
import { describe, expect, it } from "bun:test";

function checks(): NonNullable<ScoreAssessmentInput["preferenceChecks"]> {
  return {
    level: { status: "unknown", explanation: "The posting does not state a level.", evidence: [] },
    workMode: {
      status: "unknown",
      explanation: "The posting does not state a work mode.",
      evidence: [],
    },
    employmentType: {
      status: "matched",
      explanation: "Full-time matches the saved preference.",
      evidence: [{ source: "type", start: 0, end: 9, quote: "Full-time" }],
    },
    location: {
      status: "matched",
      explanation: "Toronto matches the saved preference.",
      evidence: [{ source: "location", start: 0, end: 7, quote: "Toronto" }],
    },
    eligibility: [],
  };
}

describe("separate application checks", () => {
  it("preserves unknown preferences and evidence without changing qualification points", () => {
    const context = scoringContext();
    const input = { ...scoringInput(context), preferenceChecks: checks() };
    const baseline = assessFit(context, scoringInput(context));
    const result = fitAssessmentSchema.parse(assessFit(context, input));
    expect(result.score).toBe(baseline.score);
    expect(result.preferenceChecks).toEqual(input.preferenceChecks);
    expect(result.preferenceChecks?.level.status).toBe("unknown");
    expect(result.preferenceChecks?.eligibility).toEqual([]);
  });

  it("does not erase saved preferences or invent restrictions for empty preferences", () => {
    const context = scoringContext();
    const input = { ...scoringInput(context), preferenceChecks: checks() };
    input.preferenceChecks.level.status = "not_restricted";
    expect(() => assessFit(context, input)).toThrow("saved preference");
    context.preferences.jobPreferences.levels = [];
    expect(assessFit(context, input).preferenceChecks?.level.status).toBe("not_restricted");
    context.preferences.preferredLocations = [];
    expect(() => assessFit(context, input)).toThrow("unrestricted");
  });

  it("rejects invented JD evidence and unsupported preference matches", () => {
    const context = scoringContext();
    const input = { ...scoringInput(context), preferenceChecks: checks() };
    input.preferenceChecks.location.evidence[0].quote = "Vancouver";
    expect(() => assessFit(context, input)).toThrow("exact posting spans");
    input.preferenceChecks = checks();
    input.preferenceChecks.level.status = "matched";
    expect(() => assessFit(context, input)).toThrow("posting evidence");
  });

  it("keeps a known eligibility conflict separate even when qualifications score highly", () => {
    const context = scoringContext();
    const requirement = "Applicants must have authorization to work in Canada.";
    context.job.description += `\n${requirement}`;
    const input = { ...scoringInput(context), preferenceChecks: checks() };
    const start = context.job.description.indexOf(requirement);
    input.preferenceChecks.eligibility = [
      {
        requirement,
        status: "not_met",
        explanation: "The confirmed applicant answer conflicts with this requirement.",
        evidence: [
          { source: "description", start, end: start + requirement.length, quote: requirement },
        ],
      },
    ];
    const result = assessFit(context, input);
    expect(result.score).toBe(100);
    expect(result.preferenceChecks?.eligibility[0].status).toBe("not_met");
    input.preferenceChecks.eligibility[0].evidence[0].start++;
    expect(() => assessFit(context, input)).toThrow("exact posting spans");
  });
});
