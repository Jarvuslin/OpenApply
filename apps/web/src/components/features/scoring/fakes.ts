import type { EvaluationReport } from "@openapply/contracts/scoring-evaluation";

export function evaluationReportFixture(): EvaluationReport {
  const metrics = {
    pairs: 0,
    exactScoreAgreement: null,
    meanAbsoluteScoreDifference: null,
    cutoffAgreement: null,
    candidatePassBaselineFail: 0,
    candidateFailBaselinePass: 0,
    decisionDisagreements: 0,
    roleDisagreements: 0,
    preferenceDisagreements: 0,
    escalationCases: 0,
  };
  const measurement = { available: 0, unavailable: 0, total: null, mean: null };
  const usage = {
    results: 0,
    latencyMs: measurement,
    requests: measurement,
    inputTokens: measurement,
    cacheWriteTokens: measurement,
    cacheReadTokens: measurement,
    outputTokens: measurement,
  };
  return {
    run: {
      id: "94008cd2-afd7-4c7e-aefb-c8c6348d0f8a",
      name: "Synthetic scoring report",
      cohort: "historical_synthetic",
      caseCount: 2,
      baselineModel: "sonnet",
      candidateModel: "haiku",
      escalationBand: 5,
      policyVersion: 1,
      createdAt: new Date(0),
      productionScoresUnchanged: true,
    },
    totalCases: 2,
    validPairs: 0,
    measuredPairs: 0,
    excludedPairs: 0,
    failedCases: 0,
    unrunCases: 2,
    incompleteCases: 0,
    comparison: metrics,
    measured: metrics,
    usage: { baseline: usage, candidate: usage },
    measurementStatus: "not_run",
    limitations: [],
  };
}
