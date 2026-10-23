import { fitAssessmentSchema } from "@openapply/contracts/scoring";

export function jobView<T extends { fitAssessment: unknown }>(job: T) {
  return {
    ...job,
    fitAssessment: job.fitAssessment === null ? null : fitAssessmentSchema.parse(job.fitAssessment),
  };
}
