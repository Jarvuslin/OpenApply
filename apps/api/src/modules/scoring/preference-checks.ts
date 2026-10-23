import type { FitContext, ScoreAssessmentInput } from "@openapply/contracts/scoring";
import { unprocessable } from "@/common/errors";

export function validatePreferenceChecks(
  context: FitContext,
  checks: NonNullable<ScoreAssessmentInput["preferenceChecks"]>,
): void {
  const restrictions = {
    level: context.preferences.jobPreferences.levels,
    workMode: context.preferences.jobPreferences.workModes,
    employmentType: context.preferences.jobPreferences.employmentTypes,
    location: context.preferences.preferredLocations,
  };
  for (const field of ["level", "workMode", "employmentType", "location"] as const) {
    const check = checks[field];
    if (!check.explanation.trim()) throw unprocessable(`${field} needs an explanation.`);
    if (restrictions[field].length === 0 && check.status !== "not_restricted")
      throw unprocessable(`${field} is unrestricted in the saved profile.`);
    if (restrictions[field].length > 0 && check.status === "not_restricted")
      throw unprocessable(`${field} has a saved preference; compare it with the posting.`);
    if (["matched", "mismatch"].includes(check.status) && check.evidence.length === 0)
      throw unprocessable(`${field} needs posting evidence for a match or mismatch.`);
  }
  for (const check of [
    checks.level,
    checks.workMode,
    checks.employmentType,
    checks.location,
    ...checks.eligibility,
  ]) {
    for (const span of check.evidence) {
      const source = context.job[span.source] ?? "";
      if (
        span.end <= span.start ||
        span.end > source.length ||
        source.slice(span.start, span.end) !== span.quote ||
        !span.quote.trim()
      )
        throw unprocessable("Preference and eligibility evidence must quote exact posting spans.");
    }
  }
}
