import type { FitAssessment } from "@openapply/contracts/scoring";
import {
  type EvaluationCase,
  type EvaluationReport,
  type EvaluationResult,
  type EvaluationRun,
  evaluationReportSchema,
} from "@openapply/contracts/scoring-evaluation";
import { evaluationHash } from "./evaluation.hash";

function measured(result: EvaluationResult) {
  return (
    result.origin === "local_inference" &&
    result.actualModels.length > 0 &&
    result.actualModels.every(
      (model) => model.startsWith("claude-") && model.split("-").includes(result.requestedModel),
    )
  );
}
function decision(row: EvaluationCase, assessment: FitAssessment) {
  const checks = assessment.preferenceChecks;
  if (
    row.eligibility.outcome === "ineligible" ||
    assessment.score < row.context.minMatchScore ||
    assessment.roleMatch.relevance === "outside_preferences" ||
    (checks &&
      [checks.level, checks.location, checks.employmentType, checks.workMode].some(
        (check) => check.status === "mismatch",
      ))
  )
    return "skip";
  if (
    row.eligibility.outcome === "needs_review" ||
    assessment.roleMatch.family === "Unclear" ||
    assessment.roleMatch.relevance === "unclear" ||
    !checks ||
    [checks.level, checks.location, checks.employmentType, checks.workMode].some(
      (check) => check.status === "unknown",
    ) ||
    checks.eligibility.some((check) => check.status !== "met")
  )
    return "review";
  return "continue";
}
function preferenceDecision(assessment: FitAssessment) {
  const checks = assessment.preferenceChecks;
  if (!checks) return null;
  return [
    checks.level.status,
    checks.workMode.status,
    checks.employmentType.status,
    checks.location.status,
    checks.eligibility.map((check) => [check.requirement, check.status]),
  ];
}
function metrics(rows: EvaluationCase[], band: number): EvaluationReport["comparison"] {
  let exact = 0,
    difference = 0,
    cutoff = 0,
    candidatePassBaselineFail = 0,
    candidateFailBaselinePass = 0;
  let decisionDisagreements = 0,
    roleDisagreements = 0,
    preferenceDisagreements = 0,
    escalationCases = 0;
  for (const row of rows) {
    const a = row.results.find((result) => result.slot === "baseline")!.assessment!;
    const b = row.results.find((result) => result.slot === "candidate")!.assessment!;
    const threshold = row.context.minMatchScore;
    const apass = a.score >= threshold,
      bpass = b.score >= threshold;
    exact += Number(a.score === b.score);
    difference += Math.abs(a.score - b.score);
    cutoff += Number(apass === bpass);
    candidatePassBaselineFail += Number(!apass && bpass);
    candidateFailBaselinePass += Number(apass && !bpass);
    const disagrees = decision(row, a) !== decision(row, b);
    decisionDisagreements += Number(disagrees);
    roleDisagreements += Number(
      a.roleMatch.family !== b.roleMatch.family || a.roleMatch.relevance !== b.roleMatch.relevance,
    );
    preferenceDisagreements += Number(
      evaluationHash(preferenceDecision(a)) !== evaluationHash(preferenceDecision(b)),
    );
    escalationCases += Number(
      disagrees ||
        apass !== bpass ||
        Math.abs(b.score - threshold) <= band ||
        a.verdict === "needs_review" ||
        b.verdict === "needs_review" ||
        a.confidence < 1 ||
        b.confidence < 1 ||
        decision(row, a) === "review" ||
        decision(row, b) === "review",
    );
  }
  return {
    pairs: rows.length,
    exactScoreAgreement: rows.length ? exact / rows.length : null,
    meanAbsoluteScoreDifference: rows.length ? difference / rows.length : null,
    cutoffAgreement: rows.length ? cutoff / rows.length : null,
    candidatePassBaselineFail,
    candidateFailBaselinePass,
    decisionDisagreements,
    roleDisagreements,
    preferenceDisagreements,
    escalationCases,
  };
}
function usage(results: EvaluationResult[]): EvaluationReport["usage"]["baseline"] {
  const observations = results.filter((result) => result.origin === "local_inference");
  function metric(
    name:
      | "latencyMs"
      | "requests"
      | "inputTokens"
      | "cacheWriteTokens"
      | "cacheReadTokens"
      | "outputTokens",
  ) {
    const values = observations.flatMap((result) => {
      const value = result.telemetry[name];
      return value !== null &&
        (name === "latencyMs" || result.telemetry.provenance === "provider_observed")
        ? [value]
        : [];
    });
    const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    return {
      available: values.length,
      unavailable: observations.length - values.length,
      total,
      mean: total === null ? null : total / values.length,
    };
  }
  return {
    results: observations.length,
    latencyMs: metric("latencyMs"),
    requests: metric("requests"),
    inputTokens: metric("inputTokens"),
    cacheWriteTokens: metric("cacheWriteTokens"),
    cacheReadTokens: metric("cacheReadTokens"),
    outputTokens: metric("outputTokens"),
  };
}
export function evaluationReport(run: EvaluationRun, cases: EvaluationCase[]): EvaluationReport {
  const valid = cases.filter(
    (row) =>
      row.results.length === 2 &&
      row.results.every((result) => result.status === "completed" && result.assessment),
  );
  const real = valid.filter((row) => row.results.every(measured));
  const failedCases = cases.filter((row) =>
    row.results.some((result) => result.status !== "completed"),
  ).length;
  const unrunCases = cases.filter((row) => row.results.length === 0).length;
  return evaluationReportSchema.parse({
    run,
    totalCases: cases.length,
    validPairs: valid.length,
    measuredPairs: real.length,
    excludedPairs: valid.length - real.length,
    failedCases,
    unrunCases,
    incompleteCases: cases.length - valid.length - failedCases - unrunCases,
    comparison: metrics(valid, run.escalationBand),
    measured: metrics(real, run.escalationBand),
    usage: {
      baseline: usage(
        cases.flatMap((row) => row.results.filter((result) => result.slot === "baseline")),
      ),
      candidate: usage(
        cases.flatMap((row) => row.results.filter((result) => result.slot === "candidate")),
      ),
    },
    measurementStatus:
      real.length === 0 ? "not_run" : real.length === cases.length ? "measured" : "partial",
    limitations: [
      "Historical judgments are references, not ground truth.",
      "Historical, simulated, and unidentified model pairs are excluded from measured comparisons.",
      "Usage and model identities are reported by the local runner, not independently verified by the server. Latency is a reported local-clock observation. Missing values remain unavailable.",
      "Token counts do not establish Claude Pro allowance percentages or actual charges.",
      "English eligibility patterns cover explicit US/Canada statements only; unknown facts or country remain review items.",
      "Evaluation records never change production scores, defaults, queue work, or submission permission.",
    ],
  });
}
