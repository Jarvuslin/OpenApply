import type { EvaluationResult } from "@openapply/contracts/scoring-evaluation";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluationReportFixture } from "./fakes";
import { ScoringReport } from "./scoring-report";
import { ScoringResult } from "./scoring-result";
import { expect, test } from "bun:test";

test("pending provider metrics remain unmeasured even when the returned count fields are zero", () => {
  const html = renderToStaticMarkup(<ScoringReport report={evaluationReportFixture()} />);
  expect(html).toContain("Awaiting approved run");
  expect(html).toContain("Unrun cases: 2");
  expect(html).toContain("Total cases: 2");
  expect(html).toContain("Not measured");
  expect(html).not.toContain(">0%</td>");
  expect(html).toContain("Claude Pro allowance or a bill");
  expect(html).not.toContain("<button");
});

test("validated synthetic agreements keep the measured-provider denominator at zero", () => {
  const pending = evaluationReportFixture();
  const html = renderToStaticMarkup(
    <ScoringReport
      report={{
        ...pending,
        validPairs: 2,
        excludedPairs: 2,
        unrunCases: 0,
        comparison: {
          ...pending.comparison,
          pairs: 2,
          exactScoreAgreement: 1,
          cutoffAgreement: 1,
          meanAbsoluteScoreDifference: 0,
        },
      }}
    />,
  );
  expect(html).toContain("Provider comparison not measured");
  expect(html).toContain("Excluded pairs: 2");
  expect(html).toContain("All validated pairs (2)");
  expect(html).toContain("Measured provider pairs (0)");
  expect(html).toContain("100%");
  expect(html).toContain("Not measured");
  expect(html).toContain("Production scores and defaults are unchanged");
});

test("unrun result slots cannot imply failed or zero-score model executions", () => {
  const html = renderToStaticMarkup(<ScoringResult slot="candidate" result={undefined} />);
  expect(html).toContain("candidate: Unrun");
  expect(html).not.toContain("Score:");
  expect(html).not.toContain("failed");
});

test("historical reference metadata never attributes an unknown execution to the planned Sonnet slot", () => {
  const reference: EvaluationResult = {
    id: "0623f1db-5874-4e0d-b656-f7b4668437ed",
    caseId: "6b4088e1-4fc7-4800-af8f-2669e8f2140a",
    slot: "baseline",
    origin: "historical",
    requestedModel: "sonnet",
    actualModels: [],
    modelVersion: null,
    status: "rejected",
    failureCode: "invalid_output",
    assessment: null,
    validationReason: "Historical reference failed exact input validation.",
    telemetry: {
      provenance: "unavailable",
      latencyMs: null,
      requests: null,
      inputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
    },
    createdAt: new Date(0),
    verification: "reported",
  };
  const html = renderToStaticMarkup(<ScoringResult slot="baseline" result={reference} />);
  expect(html).toContain("Historical model: Unavailable.");
  expect(html).toContain("No model was requested for this historical reference");
  expect(html).not.toContain("Requested model:");
  expect(html).not.toContain("sonnet");
});
