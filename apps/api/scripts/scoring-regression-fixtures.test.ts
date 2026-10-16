import { readFile } from "node:fs/promises";
import { fitAssessmentSchema, fitContextSchema } from "@openapply/contracts/scoring";
import { evaluationResultInputSchema } from "@openapply/contracts/scoring-evaluation";
import { assessFit } from "../src/modules/scoring/assessment";
import { evaluationHash } from "../src/modules/scoring-evaluation/evaluation.hash";
import { caseFixture } from "../src/modules/scoring-evaluation/fakes";
import { submittedResult } from "./scoring-regression-fixtures";
import { describe, expect, it } from "bun:test";

const corpus = JSON.parse(
  await readFile(
    new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
    "utf8",
  ),
);
describe("preserved synthetic scoring fixture projection", () => {
  it("replays all four historical judgments through the strict input DTO without carrying derived scores or changing source evidence", () => {
    const original = JSON.stringify(corpus);
    expect(corpus.cases).toHaveLength(4);
    for (const entry of corpus.cases) {
      const context = fitContextSchema.parse(entry.context);
      const reference = fitAssessmentSchema.parse(entry.historical.assessment);
      const row = {
        ...caseFixture(),
        jobKey: String(entry.fixture),
        context,
        contextHash: evaluationHash(context),
        historicalReference: reference,
      };
      for (const slot of ["baseline", "candidate"] as const) {
        const input = evaluationResultInputSchema.parse(submittedResult(row, slot));
        expect(input.origin).toBe("simulated");
        expect(input.actualModels).toEqual([]);
        expect(input.telemetry.requests).toBeNull();
        expect(input.judgments).not.toHaveProperty("score");
        expect(input.judgments).not.toHaveProperty("basis");
        expect(input.judgments?.roleMatch).not.toHaveProperty("relevance");
        expect(
          input.judgments?.assessments.every((assessment) => !("criterion" in assessment)),
        ).toBe(true);
        expect(
          assessFit(context, {
            campaignId: row.campaignId,
            jobKey: row.jobKey,
            basis: context.basis,
            ...input.judgments!,
          }),
        ).toEqual(reference);
      }
    }
    expect(JSON.stringify(corpus)).toBe(original);
  });
});
