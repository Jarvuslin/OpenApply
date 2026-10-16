import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fitContextSchema, scoreAssessmentInputSchema } from "@openapply/contracts/scoring";
import { jobPreferencesSchema, workAuthorizationSchema } from "@openapply/contracts/user";
import { syntheticApplicant } from "../../../scripts/apply-e2e/applicant.mjs";
import { CASES } from "../../../scripts/apply-e2e/cases.mjs";
import { assessFit } from "../src/modules/scoring/assessment";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function historicalScoringCorpus(reportBytes: Buffer, originalText: string) {
  assert(reportBytes.length < 5_000_000, "Historical report exceeds its bound.");
  const report = JSON.parse(reportBytes.toString("utf8"));
  assert.equal(report.runId, "phase1-20261008-g");
  assert.equal(report.realAgent, "completed");
  assert.equal(report.aggregates?.passed, true);
  assert.equal(report.cases?.length, 4);
  assert(report.cases.every((entry: { passed: boolean }) => entry.passed === true));
  assert.equal(report.records?.length, 4);
  const applicant = syntheticApplicant(report.runId);
  assert.equal(
    originalText,
    applicant.originalText,
    "Only the known synthetic original is accepted.",
  );
  const saved = jobPreferencesSchema.parse(applicant.profile.jobPreferences);
  const preferences = {
    jobPreferences: {
      ...saved,
      roles: [...saved.roles].sort(),
      levels: [...saved.levels].sort(),
      workModes: [...saved.workModes].sort(),
      employmentTypes: [...saved.employmentTypes].sort(),
    },
    preferredLocations: [...applicant.profile.preferredLocations].sort(),
    workAuthorization: workAuthorizationSchema
      .parse(applicant.profile.workAuthorization)
      .sort((a, b) => a.country.localeCompare(b.country)),
  };
  const cases = CASES.map((expected) => {
    const records = report.records.filter(
      (entry: { caseId: string }) => entry.caseId === expected.id,
    );
    assert.equal(records.length, 1, "Every historical case must be present exactly once.");
    const job = records[0].job;
    const historical = job.fitAssessment;
    assert.equal(job.status, "applied");
    assert.equal(job.matchScore, historical.score);
    assert.equal(job.title, expected.title);
    assert.equal(job.company, `${expected.company} ${report.runId}`);
    const observed = report.manifest.cases.find(
      (entry: { id: string }) => entry.id === expected.id,
    );
    assert.equal(
      job.description,
      `${job.title}\n\n${job.company} · Remote, Canada · Full time\n\nAbout the role\n\n${observed.description}`,
    );
    assert.equal(job.url, observed.url);
    const url = new URL(job.url);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(historical.basis.sourceSha256, digest(originalText));
    assert.equal(historical.basis.sourceTextSha256, digest(originalText));
    assert.equal(historical.basis.preferencesSha256, digest(JSON.stringify(preferences)));
    const posting = {
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.location,
      type: job.type,
      description: job.description,
    };
    assert.equal(historical.basis.jobSha256, digest(JSON.stringify(posting)));
    const context = fitContextSchema.parse({
      basis: historical.basis,
      job: {
        ...posting,
        criteria: historical.assessments.map((entry: { criterion: unknown }) => entry.criterion),
      },
      resume: { text: originalText },
      preferences,
      minMatchScore: 60,
      cachedAssessment: null,
    });
    const input = scoreAssessmentInputSchema.parse({
      campaignId: job.campaignId,
      jobKey: job.key,
      resumeId: historical.basis.resumeId,
      basis: historical.basis,
      assessments: historical.assessments,
      roleMatch: historical.roleMatch,
      preferenceChecks: historical.preferenceChecks,
    });
    assert.deepEqual(
      assessFit(context, input),
      historical,
      "Historical quotes/arithmetic must still validate exactly.",
    );
    return {
      caseId: job.id,
      fixture: expected.id,
      context,
      historical: { origin: "historical", actualModel: null, usage: null, assessment: historical },
    };
  });
  return {
    version: 1,
    provenance: {
      origin: "preserved_synthetic",
      sourceRunId: report.runId,
      sourceReportSha256: digest(reportBytes),
      originalTextSha256: digest(originalText),
      validation: "exact_source_hashes_quotes_and_arithmetic",
      limitation:
        "Four positive fixtures, all score 100; not representative model-comparison evidence. Actual model and usage are not attested by this report.",
    },
    cases,
  };
}
