// Route validation failures back to the wizard step that owns the field.
const FIELD_TO_STEP: Record<string, number> = {
  firstName: 1,
  lastName: 1,
  contactEmail: 1,
  phone: 1,
  website: 1,
  linkedin: 1,
  github: 1,
  street: 1,
  city: 1,
  state: 1,
  zipCode: 1,
  country: 1,
  usAuthorized: 2,
  requiresSponsorship: 2,
  preferredLocations: 2,
  salaryPreferences: 3,
  references: 3,
  autoApply: 3,
};

export interface ValidationIssue {
  field: string;
  path: string;
  message: string;
  stepIndex: number | null;
}

export function describeIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): ValidationIssue[] {
  return issues.map((issue) => {
    const field = String(issue.path[0] ?? "");
    return {
      field,
      path: issue.path.map(String).join(".") || "form",
      message: issue.message,
      stepIndex: FIELD_TO_STEP[field] ?? null,
    };
  });
}

export function firstStepWithIssue(issues: ValidationIssue[]): number | null {
  for (const issue of issues) {
    if (issue.stepIndex !== null) {
      return issue.stepIndex;
    }
  }
  return null;
}
