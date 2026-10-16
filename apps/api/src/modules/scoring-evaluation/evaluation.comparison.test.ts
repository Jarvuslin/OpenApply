import { evaluationReport } from "./evaluation.comparison";
import { caseFixture, resultFixture, runFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("separate replay and measured scoring reports", () => {
  it("keeps absent comparison and usage null while naming unrun cases", () => {
    const row = caseFixture();
    const report = evaluationReport(runFixture(row), [row]);
    expect(report.unrunCases).toBe(1);
    expect(report.measuredPairs).toBe(0);
    expect(report.measurementStatus).toBe("not_run");
    expect(report.comparison.meanAbsoluteScoreDifference).toBeNull();
    expect(report.measured.cutoffAgreement).toBeNull();
    expect(report.usage.baseline.requests.total).toBeNull();
    expect(report.usage.candidate.latencyMs.mean).toBeNull();
  });
  it("excludes historical and simulated pairs from measured results even when scores agree", () => {
    const row = caseFixture();
    row.results = [
      resultFixture(row, "baseline", { origin: "historical" }),
      resultFixture(row, "candidate"),
    ];
    const report = evaluationReport(runFixture(row), [row]);
    expect(report.validPairs).toBe(1);
    expect(report.excludedPairs).toBe(1);
    expect(report.measuredPairs).toBe(0);
    expect(report.comparison.exactScoreAgreement).toBe(1);
    expect(report.measured.exactScoreAgreement).toBeNull();
    expect(report.usage.baseline.results).toBe(0);
  });
  it("measures actual named local model pairs but never fills missing usage counters with zero", () => {
    const row = caseFixture();
    row.results = ["baseline", "candidate"].map((slot) => {
      const kind = slot as "baseline" | "candidate";
      const result = resultFixture(row, kind, { origin: "local_inference" });
      result.actualModels = [`claude-${result.requestedModel}-4-5-20250929`];
      result.telemetry = {
        provenance: "provider_observed",
        latencyMs: 250,
        requests: null,
        inputTokens: 50,
        cacheWriteTokens: null,
        cacheReadTokens: 0,
        outputTokens: 10,
      };
      return result;
    });
    const report = evaluationReport(runFixture(row), [row]);
    expect(report.measuredPairs).toBe(1);
    expect(report.measurementStatus).toBe("measured");
    expect(report.usage.baseline.requests).toEqual({
      available: 0,
      unavailable: 1,
      total: null,
      mean: null,
    });
    expect(report.usage.baseline.cacheReadTokens.total).toBe(0);
    expect(report.usage.baseline.latencyMs.mean).toBe(250);
    row.results[0].actualModels = [];
    expect(evaluationReport(runFixture(row), [row]).excludedPairs).toBe(1);
    row.results[0].actualModels = ["sonnet"];
    expect(evaluationReport(runFixture(row), [row]).excludedPairs).toBe(1);
    row.results[0].actualModels = ["claude-haiku-4-5"];
    expect(evaluationReport(runFixture(row), [row]).excludedPairs).toBe(1);
  });
  it("reports cutoff direction, absolute score difference and escalation at the exact boundary", () => {
    const row = caseFixture();
    row.results = [resultFixture(row, "baseline"), resultFixture(row, "candidate")];
    row.results[0].assessment = { ...row.historicalReference!, score: 59 };
    row.results[1].assessment = { ...row.historicalReference!, score: 60 };
    const report = evaluationReport(runFixture(row), [row]);
    expect(report.comparison.meanAbsoluteScoreDifference).toBe(1);
    expect(report.comparison.cutoffAgreement).toBe(0);
    expect(report.comparison.candidatePassBaselineFail).toBe(1);
    expect(report.comparison.candidateFailBaselinePass).toBe(0);
    expect(report.comparison.escalationCases).toBe(1);
    expect(report.comparison.decisionDisagreements).toBe(1);
  });
  it("partitions failure/incomplete/unrun/valid cases and retains spend from failed local output", () => {
    const rows = [caseFixture(), caseFixture(), caseFixture(), caseFixture()];
    rows[0].results = [resultFixture(rows[0], "baseline"), resultFixture(rows[0], "candidate")];
    rows[1].results = [resultFixture(rows[1], "baseline")];
    const failed = resultFixture(rows[2], "candidate", {
      origin: "local_inference",
      status: "failed",
      failureCode: "provider_error",
      assessment: null,
    });
    failed.telemetry = {
      provenance: "provider_observed",
      latencyMs: 12,
      requests: 1,
      inputTokens: 30,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
    };
    rows[2].results = [failed];
    const report = evaluationReport({ ...runFixture(rows[0]), caseCount: 4 }, rows);
    expect([
      report.totalCases,
      report.validPairs,
      report.failedCases,
      report.incompleteCases,
      report.unrunCases,
    ]).toEqual([4, 1, 1, 1, 1]);
    expect(report.usage.candidate.requests.total).toBe(1);
    expect(report.usage.candidate.inputTokens.total).toBe(30);
    expect(report.usage.candidate.outputTokens.total).toBeNull();
    expect(report.measuredPairs).toBe(0);
  });
});
