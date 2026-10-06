// Route validation failures back to the wizard step that owns the field.
const FIELD_TO_STEP: Record<string, number> = {
  firstName: 2,
  lastName: 2,
  contactEmail: 2,
  phone: 2,
  website: 2,
  linkedin: 2,
  github: 2,
  street: 2,
  city: 2,
  state: 2,
  zipCode: 2,
  country: 2,
  usAuthorized: 3,
  requiresSponsorship: 3,
  preferredLocations: 3,
  salaryPreferences: 4,
  references: 4,
  autoApply: 4,
  jobPreferences: 4,
  workAuthorization: 3,
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
