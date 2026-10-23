import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resumeDataSchema } from "@openapply/contracts/resume";
import { fitAssessmentSchema, fitContextSchema } from "@openapply/contracts/scoring";
import {
  type CreateEvaluation,
  type EvaluationCase,
  type EvaluationResultInput,
  evaluationJudgmentsSchema,
} from "@openapply/contracts/scoring-evaluation";
import { z } from "zod/v4";
import { db } from "../src/common/database/prisma.client";
import { toInputJson } from "../src/common/json";
import { env } from "../src/env";
import type { Job } from "../src/generated/prisma/client";
import { OriginalResumeSource } from "../src/modules/scoring/original-source";
import { ScoringService } from "../src/modules/scoring/scoring.service";
import { ScoringEvaluationService } from "../src/modules/scoring-evaluation/scoring-evaluation.service";

export const uuid = () => crypto.randomUUID();
export const scoring = new ScoringService(db, new OriginalResumeSource());
export const evaluations = new ScoringEvaluationService(db, scoring);
const corpusSchema = z.object({
  version: z.literal(1),
  cases: z
    .array(
      z.object({
        caseId: z.uuid(),
        fixture: z.string(),
        context: fitContextSchema,
        historical: z.object({
          origin: z.literal("historical"),
          actualModel: z.null(),
          usage: z.null(),
          assessment: fitAssessmentSchema,
        }),
      }),
    )
    .length(4),
});
const corpus = corpusSchema.parse(
  JSON.parse(
    await readFile(
      new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
      "utf8",
    ),
  ),
);

export async function scoringFixture(
  label: string,
  options: { email?: string; password?: string; historical?: boolean } = {},
) {
  const original = corpus.cases[0].context;
  const user = await db.user.create({
    data: {
      email: options.email ?? `${uuid()}@scoring.example.test`,
      username: uuid(),
      firstName: "Scoring",
      lastName: "Fixture",
      emailVerified: true,
      jobPreferences: toInputJson(original.preferences.jobPreferences),
      preferredLocations: JSON.stringify(original.preferences.preferredLocations),
      workAuthorization: toInputJson(original.preferences.workAuthorization),
      ...(options.password ? { passwordHash: await Bun.password.hash(options.password) } : {}),
    },
  });
  const filename = `${uuid()}.txt`;
  const directory = path.resolve(env.STORAGE_ROOT, "resumes");
  await mkdir(directory, { recursive: true });
  const sourceFile = path.join(directory, filename);
  await writeFile(sourceFile, original.resume.text, { flag: "wx" });
  const resume = await db.resume.create({
    data: {
      ...(options.historical ? { id: original.basis.resumeId } : {}),
      userId: user.id,
      label: "Synthetic original text",
      sourceFilename: filename,
      sourceMimeType: "text/plain",
      sourceSizeBytes: Buffer.byteLength(original.resume.text),
      content: toInputJson(resumeDataSchema.parse({ basics: { name: "Scoring Fixture" } })),
    },
  });
  await db.user.update({ where: { id: user.id }, data: { primaryResumeId: resume.id } });
  const campaign = await db.campaign.create({
    data: {
      userId: user.id,
      source: "apply",
      query: label,
      config: { resumeId: resume.id, minScore: 60 },
    },
  });
  const jobs: Job[] = [];
  for (const entry of corpus.cases) {
    const { criteria: _criteria, ...job } = entry.context.job;
    jobs.push(
      await db.job.create({
        data: {
          ...job,
          campaignId: campaign.campaignId,
          key: entry.fixture,
          status: "approved",
          ...(options.historical
            ? {
                fitAssessment: toInputJson(entry.historical.assessment),
                matchScore: entry.historical.assessment.score,
                matchReason: entry.historical.assessment.matchReason,
              }
            : {}),
        },
      }),
    );
  }
  const create = async (name: string, indices = [0, 1, 2, 3]): Promise<CreateEvaluation> => ({
    requestId: uuid(),
    name,
    cohort: options.historical ? "historical_synthetic" : "authored",
    escalationBand: 5,
    cases: await Promise.all(
      indices.map(async (index) => {
        const job = jobs[index];
        assert.ok(job);
        const context = await scoring.context(user.id, {
          campaignId: campaign.campaignId,
          jobKey: job.key,
        });
        if (options.historical)
          assert.deepEqual(context.cachedAssessment, corpus.cases[index].historical.assessment);
        return { jobId: job.id, expectedBasis: context.basis };
      }),
    ),
  });
  return { user, resume, campaign, jobs, sourceFile, sourceText: original.resume.text, create };
}

export function submittedResult(
  row: EvaluationCase,
  slot: "baseline" | "candidate" = "baseline",
): EvaluationResultInput {
  const reference =
    corpus.cases.find((entry) => entry.fixture === row.jobKey)?.historical.assessment ??
    corpus.cases[0].historical.assessment;
  return {
    requestId: uuid(),
    expectedContextHash: row.contextHash,
    slot,
    origin: "simulated",
    requestedModel: slot === "baseline" ? "sonnet" : "haiku",
    actualModels: [],
    modelVersion: null,
    status: "completed",
    failureCode: null,
    judgments: evaluationJudgmentsSchema.parse({
      assessments: reference.assessments.map(
        ({ criterionId, category, rating, evidence, explanation }) => ({
          criterionId,
          category,
          rating,
          evidence,
          explanation,
        }),
      ),
      roleMatch: {
        family: reference.roleMatch.family,
        evidence: reference.roleMatch.evidence,
        explanation: reference.roleMatch.explanation,
      },
      ...(reference.preferenceChecks ? { preferenceChecks: reference.preferenceChecks } : {}),
    }),
    telemetry: {
      provenance: "simulated",
      latencyMs: null,
      requests: null,
      inputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
    },
    requestIdentityHashes: [],
  };
}

export async function productionFingerprint(userId: string, sourceFile: string) {
  const [jobs, campaigns, resumes, work, attempts, source] = await Promise.all([
    db.job.findMany({ where: { campaign: { userId } }, orderBy: { id: "asc" } }),
    db.campaign.findMany({ where: { userId }, orderBy: { campaignId: "asc" } }),
    db.resume.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.workItem.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.submissionAttempt.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    readFile(sourceFile),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ jobs, campaigns, resumes, work, attempts }))
    .update(source)
    .digest("hex");
}
