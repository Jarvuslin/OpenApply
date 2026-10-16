export const NO_EXPERIENCE_LABEL = "No prior experience required";

/** "Any", "Up to 3 years", "5+ years" or "2–5 years"; null leaves that end open. */
export function yearsLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return "Any";
  if (min === null) return max === 0 ? "No years required" : `Up to ${max} years`;
  if (max === null) return `${min}+ years`;
  return min === max ? `${min} years` : `${min}–${max} years`;
}
