export function evaluationMetric(value: number | null, suffix = ""): string {
  if (value === null) return "Not measured";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

interface EvaluationCoverage {
  measuredPairs: number;
  validPairs: number;
  unrunCases: number;
  totalCases: number;
}

export function evaluationCoverageLabel(coverage: EvaluationCoverage): string {
  if (coverage.measuredPairs > 0) {
    if (coverage.measuredPairs < coverage.totalCases) return "Partial provider measurements";
    return "Measured provider pairs";
  }
  if (coverage.validPairs > 0) return "Provider comparison not measured";
  if (coverage.unrunCases === coverage.totalCases) return "Awaiting approved run";
  return "No valid provider pairs";
}
