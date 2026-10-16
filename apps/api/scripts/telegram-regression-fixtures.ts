import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fitAssessmentSchema, scoreAssessmentInputSchema } from "@openapply/contracts/scoring";
import { db } from "../src/common/database/prisma.client";
import { SubmissionService } from "../src/modules/application/submission.service";
import { SubmissionAttemptService } from "../src/modules/application/submission-attempt.service";
import { ApplicationRulesService } from "../src/modules/application-rules/application-rules.service";
import { JobIntakeService } from "../src/modules/job-intakes/job-intake.service";
import { PilotCheckpointApprovalService } from "../src/modules/pilot/checkpoint-approval.service";
import { RuntimePresenceService } from "../src/modules/runtime-presence/runtime-presence.service";
import { artifacts, documentFixture, preparation } from "./preparation-regression-fixtures";
import { fixture, uuid } from "./question-regression-fixtures";
import { scoring, scoringFixture } from "./scoring-regression-fixtures";

export const intakes = new JobIntakeService(db, scoring);
export const rules = new ApplicationRulesService(db);
export const presence = new RuntimePresenceService(db);
export const approvals = new PilotCheckpointApprovalService(db);
const files = new SubmissionService(db);
export const attempts = new SubmissionAttemptService(db, files, artifacts, scoring);

export async function telegramFixture(
  label: string,
  options: { email?: string; password?: string } = {},
) {
  const f = await fixture(label, options);
  await db.telegramSettings.create({ data: { userId: f.user.id } });
  return f;
}
export async function syntheticLink(userId: string) {
  const digits = String(BigInt(`0x${uuid().replaceAll("-", "").slice(0, 12)}`) + 1n);
  return db.telegramLink.create({
    data: {
      userId,
      generation: 1,
      active: true,
      senderId: digits,
      chatId: digits,
      linkedAt: new Date(),
    },
  });
}
export async function checkpointFixture(
  label: string,
  options: { email?: string; password?: string } = {},
) {
  const f = await documentFixture(label, options);
  await db.telegramSettings.create({ data: { userId: f.user.id } });
  await db.user.update({ where: { id: f.user.id }, data: { primaryResumeId: f.resume.id } });
  await preparation.selectDocument(f.user.id, f.question.id, f.input, "session_user");
  await db.job.update({
    where: { id: f.job.id },
    data: { status: "applying", humanApprovalRequired: true },
  });
  const retained = await files.uploadResume(
    f.user.id,
    f.campaign.campaignId,
    f.job.key,
    new File([new Uint8Array(f.bytes)], "fixture-resume.pdf", { type: "application/pdf" }),
  );
  const input = {
    resumeId: f.resume.id,
    resume: { ...retained, artifact: { resumeId: f.resume.id, revision: f.artifact.revision } },
    fields: [{ id: "resume", label: "Resume", type: "file", value: "fixture-resume.pdf" }],
    review: {
      reviewedAt: new Date().toISOString(),
      summary: "Synthetic deterministic checkpoint reviewed against the retained fixture PDF.",
      checks: {
        job: true as const,
        fields: true as const,
        resume: true as const,
        factualClaims: true as const,
      },
      issues: [],
    },
  };
  const saved = await attempts.checkpoint(f.user.id, f.campaign.campaignId, f.job.key, input);
  assert.ok(saved.attempt?.checkpointId);
  const question = await db.pilotQuestion.findFirstOrThrow({
    where: { userId: f.user.id, approvalCheckpointId: saved.attempt.checkpointId, status: "open" },
  });
  return { ...f, input, attempt: saved.attempt, approval: question };
}
export async function scoredIntakeFixture(label: string) {
  const f = await scoringFixture(label, { email: `${uuid()}@questions.example.test` });
  await db.user.update({
    where: { id: f.user.id },
    data: {
      firstName: "Questions",
      lastName: "Fixture",
      queuePolicy: { create: {} },
      telegramSettings: { create: {} },
    },
  });
  const job = await db.job.update({
    where: { id: f.jobs[0].id },
    data: { status: "pending", intakeDecisionRequired: true, humanApprovalRequired: true },
  });
  const row = await db.jobIntake.create({
    data: {
      userId: f.user.id,
      jobId: job.id,
      originalUrl: job.url,
      canonicalUrl: job.url,
      authorship: "session_user",
      resolved: true,
      reason: "Synthetic preserved scoring judgments; no model was invoked.",
    },
  });
  const corpus = JSON.parse(
    await readFile(
      new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
      "utf8",
    ),
  ) as { cases: { fixture: string; historical: { assessment: unknown } }[] };
  const reference = fitAssessmentSchema.parse(
    corpus.cases.find((entry) => entry.fixture === job.key)!.historical.assessment,
  );
  const score = async () => {
    const context = await scoring.context(f.user.id, {
      campaignId: job.campaignId,
      jobKey: job.key,
    });
    return scoring.scoreJobFit(
      f.user.id,
      scoreAssessmentInputSchema.parse({
        campaignId: job.campaignId,
        jobKey: job.key,
        basis: context.basis,
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
        preferenceChecks: reference.preferenceChecks,
      }),
    );
  };
  return { ...f, job, intake: row, score };
}
