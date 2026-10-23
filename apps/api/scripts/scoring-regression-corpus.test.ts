import { readFileSync } from "node:fs";
import { historicalScoringCorpus } from "./scoring-regression-corpus";
import { expect, test } from "bun:test";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
    "utf8",
  ),
);
function source() {
  return {
    runId: "phase1-20261008-g",
    realAgent: "completed",
    aggregates: { passed: true },
    cases: fixture.cases.map((entry: { fixture: string }) => ({
      caseId: entry.fixture,
      passed: true,
    })),
    manifest: {
      cases: fixture.cases.map(
        (entry: { fixture: string; context: { job: { description: string; url: string } } }) => ({
          id: entry.fixture,
          description: entry.context.job.description.split("\n\nAbout the role\n\n")[1],
          url: entry.context.job.url,
        }),
      ),
    },
    records: fixture.cases.map(
      (entry: {
        fixture: string;
        context: { job: object };
        historical: { assessment: { score: number } };
      }) => ({
        caseId: entry.fixture,
        job: {
          ...entry.context.job,
          campaignId: "b03b54be-a93c-455f-91a3-5b61c93b9001",
          id: crypto.randomUUID(),
          key: entry.fixture,
          status: "applied",
          matchScore: entry.historical.assessment.score,
          fitAssessment: entry.historical.assessment,
        },
      }),
    ),
    apiToken: "NEVER_EXPORT_SYNTHETIC_SECRET",
    agentMessages: [{ content: "NEVER_EXPORT_TRANSCRIPT" }],
  };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const original = fixture.cases[0].context.resume.text;

test("corpus exports only verified synthetic scoring fields, with blind model inputs", () => {
  const result = historicalScoringCorpus(bytes(source()), original);
  expect(result.cases).toHaveLength(4);
  expect(result.cases.every((entry) => entry.context.cachedAssessment === null)).toBe(true);
  expect(
    result.cases.every(
      (entry) => entry.historical.actualModel === null && entry.historical.usage === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain("NEVER_EXPORT");
});

test("a different applicant or historical run cannot become the synthetic corpus", () => {
  expect(() => historicalScoringCorpus(bytes(source()), `${original}\nA real applicant`)).toThrow();
  expect(() =>
    historicalScoringCorpus(bytes({ ...source(), runId: "phase1-20261008-i" }), original),
  ).toThrow();
});

test("historical score and source-hash drift is rejected without regenerating scores", () => {
  const changed = source();
  changed.records[0].job.matchScore = 99;
  expect(() => historicalScoringCorpus(bytes(changed), original)).toThrow();
  const changedSource = source();
  changedSource.records[0].job.fitAssessment = structuredClone(
    changedSource.records[0].job.fitAssessment,
  );
  const historical = changedSource.records[0].job.fitAssessment as {
    score: number;
    basis: { jobSha256: string };
  };
  historical.basis.jobSha256 = "0".repeat(64);
  expect(() => historicalScoringCorpus(bytes(changedSource), original)).toThrow();
});
