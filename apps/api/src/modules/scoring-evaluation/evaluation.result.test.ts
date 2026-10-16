import { evaluationResultInputSchema } from "@openapply/contracts/scoring-evaluation";
import { validateEvaluationResult } from "./evaluation.result";
import { caseFixture, resultInput } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("bounded evaluation result validation", () => {
  it("rejects missing, duplicate and fabricated criterion evidence without calculating a trusted score", () => {
    const row = caseFixture();
    for (const alter of ["missing", "duplicate", "quote"]) {
      const input = resultInput(row);
      if (alter === "missing") input.judgments!.assessments.pop();
      if (alter === "duplicate") input.judgments!.assessments.push(input.judgments!.assessments[0]);
      if (alter === "quote")
        input.judgments!.assessments.find((item) => item.evidence.length)!.evidence[0].start++;
      expect(validateEvaluationResult(row, input)).toMatchObject({
        status: "rejected",
        assessment: null,
        failureCode: "invalid_output",
      });
    }
  });
  it("rejects score/source overrides and malformed output before persistence", () => {
    const input = resultInput(caseFixture());
    for (const extra of [{ score: 99 }, { basis: {} }, { campaignId: crypto.randomUUID() }])
      expect(
        evaluationResultInputSchema.safeParse({
          ...input,
          judgments: { ...input.judgments, ...extra },
        }).success,
      ).toBe(false);
    expect(
      evaluationResultInputSchema.safeParse({
        ...input,
        telemetry: { ...input.telemetry, requests: -1 },
      }).success,
    ).toBe(false);
  });
  it("requires consistent telemetry provenance and never labels unknown usage as zero", () => {
    const row = caseFixture();
    const input = resultInput(row);
    expect(() =>
      validateEvaluationResult(row, {
        ...input,
        telemetry: { ...input.telemetry, provenance: "provider_observed" },
      }),
    ).toThrow("simulated");
    expect(() => validateEvaluationResult(row, { ...input, origin: "local_inference" })).toThrow(
      "simulated",
    );
    expect(() =>
      validateEvaluationResult(row, {
        ...input,
        origin: "local_inference",
        telemetry: { ...input.telemetry, provenance: "unavailable", inputTokens: 0 },
      }),
    ).toThrow("null");
    expect(
      validateEvaluationResult(row, {
        ...input,
        origin: "local_inference",
        telemetry: { ...input.telemetry, provenance: "unavailable", latencyMs: 12 },
      }).status,
    ).toBe("completed");
  });
  it("reuses only exact historical judgments without inventing model metadata or launch usage", () => {
    const row = caseFixture();
    const input = {
      ...resultInput(row),
      origin: "historical" as const,
      judgments: null,
      telemetry: { ...resultInput(row).telemetry, provenance: "unavailable" as const },
    };
    expect(validateEvaluationResult(row, input).assessment).toEqual(row.historicalReference);
    expect(() =>
      validateEvaluationResult(row, { ...input, actualModels: ["claude-sonnet-4-5"] }),
    ).toThrow("Historical");
    expect(() =>
      validateEvaluationResult(row, { ...input, telemetry: { ...input.telemetry, latencyMs: 0 } }),
    ).toThrow("Historical");
    row.historicalReference = { ...row.historicalReference!, score: 99 };
    expect(validateEvaluationResult(row, input).status).toBe("rejected");
  });
  it("keeps explicit failed slots terminal instead of returning a retry instruction", () => {
    const row = caseFixture();
    const input = {
      ...resultInput(row),
      status: "budget_stopped" as const,
      judgments: null,
      failureCode: "budget_tokens" as const,
    };
    expect(validateEvaluationResult(row, input)).toEqual({
      status: "budget_stopped",
      failureCode: "budget_tokens",
      assessment: null,
      validationReason: null,
    });
    expect(() => validateEvaluationResult(row, { ...input, failureCode: null })).toThrow(
      "failure code",
    );
  });
});
