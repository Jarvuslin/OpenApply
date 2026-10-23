import { evaluationCoverageLabel, evaluationMetric } from "./evaluation-display";
import { expect, test } from "bun:test";

test("unavailable measurements remain distinct from a measured zero", () => {
  expect(evaluationMetric(null)).toBe("Not measured");
  expect(evaluationMetric(null, " ms")).toBe("Not measured");
  expect(evaluationMetric(0)).toBe("0");
  expect(evaluationMetric(0, " ms")).toBe("0 ms");
  expect(evaluationMetric(1200)).toBe("1,200");
});

test("synthetic replay evidence never becomes a provider measurement", () => {
  expect(
    evaluationCoverageLabel({ totalCases: 3, measuredPairs: 0, validPairs: 2, unrunCases: 1 }),
  ).toBe("Provider comparison not measured");
  expect(
    evaluationCoverageLabel({ totalCases: 3, measuredPairs: 0, validPairs: 0, unrunCases: 3 }),
  ).toBe("Awaiting approved run");
  expect(
    evaluationCoverageLabel({ totalCases: 3, measuredPairs: 0, validPairs: 0, unrunCases: 0 }),
  ).toBe("No valid provider pairs");
  expect(
    evaluationCoverageLabel({ totalCases: 3, measuredPairs: 1, validPairs: 2, unrunCases: 1 }),
  ).toBe("Partial provider measurements");
  expect(
    evaluationCoverageLabel({ totalCases: 3, measuredPairs: 3, validPairs: 3, unrunCases: 0 }),
  ).toBe("Measured provider pairs");
});
