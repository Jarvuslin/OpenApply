import { fitAssessmentSchema, fitContextSchema } from "@openapply/contracts/scoring";
import {
  evaluationCaseSchema,
  evaluationResultSchema,
  evaluationRunSchema,
} from "@openapply/contracts/scoring-evaluation";
import type {
  ScoringEvaluationCase,
  ScoringEvaluationResult,
  ScoringEvaluationRun,
} from "@/generated/prisma/client";

export function runView(row: ScoringEvaluationRun) {
  return evaluationRunSchema.parse({
    ...row,
    baselineModel: "sonnet",
    candidateModel: "haiku",
    productionScoresUnchanged: true,
  });
}
export function resultView(row: ScoringEvaluationResult) {
  return evaluationResultSchema.parse({ ...row, verification: "reported" });
}
export function caseView(row: ScoringEvaluationCase & { results: ScoringEvaluationResult[] }) {
  return evaluationCaseSchema.parse({
    ...row,
    context: fitContextSchema.parse(row.context),
    historicalReference:
      row.historicalReference === null ? null : fitAssessmentSchema.parse(row.historicalReference),
    results: row.results.map(resultView),
  });
}
