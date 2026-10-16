import assert from "node:assert/strict";
import { db } from "../src/common/database/prisma.client";
import { assertApplicationAllowed } from "../src/modules/application-rules/application-rules.guard";
import { consumeCheckpointApproval } from "../src/modules/pilot/checkpoint-approval.service";
import { uuid } from "./question-regression-fixtures";
import {
  checkpointFixture,
  intakes,
  scoredIntakeFixture,
  telegramFixture,
} from "./telegram-regression-fixtures";

export async function verifyTelegramIntakes() {
  const checks: string[] = [];
  const f = await telegramFixture("Known Discover mapping");
  const source = `https://careers.example.test/positions/${uuid()}`;
  const target = `https://ats.example.test/applications/${uuid()}`;
  await db.jobListing.create({
    data: {
      slug: uuid(),
      dedupeKey: uuid(),
      title: "Mapped fixture job",
      company: "Synthetic Questions Fixture",
      skills: [],
      requirements: [],
      responsibilities: [],
      sources: { create: { url: source, applyUrl: target, resolutionConfidence: 1 } },
    },
  });
  const first = await intakes.create(f.user.id, { requestId: uuid(), url: source }, "session_user");
  const alias = await intakes.create(
    f.user.id,
    { requestId: uuid(), url: `${target}?utm_source=reply` },
    "session_user",
  );
  assert.equal(first.id, alias.id);
  assert.equal(first.canonicalUrl, target);
  for (const url of [source, target]) {
    await assert.rejects(
      db.$transaction((tx) =>
        assertApplicationAllowed(tx, f.user.id, { url, company: "Synthetic Questions Fixture" }),
      ),
      /choose Apply now/,
    );
  }
  checks.push(
    "validated Discover mappings dedupe source and destination and fence both identities",
  );

  const active = await telegramFixture("Existing application work");
  const activeUrl = `https://existing.example.test/jobs/${uuid()}`;
  const original = await db.job.update({
    where: { id: active.job.id },
    data: { url: activeUrl, status: "applying" },
  });
  const reused = await intakes.create(
    active.user.id,
    { requestId: uuid(), url: activeUrl },
    "session_user",
  );
  assert.equal(reused.jobId, original.id);
  assert.equal(reused.decision, "queue");
  assert.equal(
    (await db.job.findUniqueOrThrow({ where: { id: original.id } })).updatedAt.getTime(),
    original.updatedAt.getTime(),
  );
  await assert.rejects(
    intakes.prepare(
      active.user.id,
      reused.id,
      { requestId: uuid(), expectedRevision: reused.revision, provider: "claude" },
      "session_user",
    ),
  );
  await assert.rejects(
    intakes.decide(
      active.user.id,
      reused.id,
      {
        requestId: uuid(),
        expectedRevision: reused.revision,
        decision: "apply_now",
        provider: "claude",
      },
      "session_user",
    ),
  );
  assert.equal(await db.workItem.count({ where: { userId: active.user.id } }), 0);
  checks.push(
    "reused active jobs retain their workflow and cannot be restarted through an intake decision",
  );

  const prep = await scoredIntakeFixture("Explicit preparation");
  const request = { requestId: uuid(), expectedRevision: 1, provider: "claude" as const };
  await db.resume.update({ where: { id: prep.resume.id }, data: { sourceFilename: null } });
  await assert.rejects(
    intakes.prepare(prep.user.id, prep.intake.id, request, "session_user"),
    /original resume/,
  );
  await db.resume.update({
    where: { id: prep.resume.id },
    data: { sourceFilename: prep.resume.sourceFilename },
  });
  const prepared = await intakes.prepare(prep.user.id, prep.intake.id, request, "session_user");
  assert.deepEqual(
    await intakes.prepare(prep.user.id, prep.intake.id, request, "session_user"),
    prepared,
  );
  assert.match(prepared.reason, /support is unavailable/);
  const work = await db.workItem.findFirstOrThrow({ where: { userId: prep.user.id } });
  assert.equal(work.intent, "intake_prepare");
  assert.deepEqual(work.payload, { intakeId: prep.intake.id, jobIds: [prep.job.id] });
  assert.equal(work.jobId, null);
  assert.equal(await db.workExecution.count({ where: { userId: prep.user.id } }), 0);
  await assert.rejects(
    intakes.prepare(
      prep.user.id,
      prep.intake.id,
      { ...request, requestId: uuid(), expectedRevision: prepared.revision, provider: "codex" },
      "session_user",
    ),
    /cannot switch/,
  );
  checks.push(
    "preparation requires an original resume and explicit provider, persists exact scope once, and reports unsupported execution",
  );

  const approval = await checkpointFixture("Deleted original intake job");
  const originalUrl = `https://original-employer.example.test/jobs/${uuid()}`;
  await db.jobIntake.create({
    data: {
      userId: approval.user.id,
      jobId: approval.job.id,
      originalUrl,
      canonicalUrl: approval.job.url,
      authorship: "session_user",
      resolved: true,
      decision: "queue",
      reason: "Synthetic canonical approval history",
    },
  });
  const attempt = await db.submissionAttempt.findUniqueOrThrow({
    where: { id: approval.attempt.id },
  });
  await db.job.delete({ where: { id: approval.job.id } });
  for (const url of [originalUrl, approval.job.url]) {
    const duplicate = await db.job.create({
      data: {
        campaignId: approval.campaign.campaignId,
        key: uuid(),
        url,
        title: "Recreated intake identity",
        company: approval.job.company,
        status: "applying",
      },
    });
    assert.equal(duplicate.humanApprovalRequired, false);
    await assert.rejects(
      db.$transaction((tx) => consumeCheckpointApproval(tx, approval.user.id, duplicate, attempt)),
      /human approval/,
    );
  }
  checks.push(
    "checkpoint approval remains required for source and destination identities after original job deletion",
  );
  return checks;
}
