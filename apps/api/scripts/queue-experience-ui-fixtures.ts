import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applicationSubmissionRecordSchema,
  submissionCheckpointSchema,
} from "@openapply/contracts/submission";
import { databaseDiagnostic } from "../../../scripts/queue-experience-regression/bootstrap-diagnostic.mjs";
import { db } from "../src/common/database/prisma.client";
import { env } from "../src/env";
import { saveSubmissionPdf, submissionPdfPath } from "../src/modules/application/submission-files";
import { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import { countNeedsYou } from "../src/modules/application-question/question.needs-you";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import { syntheticLoginUpdate } from "./concurrency-regression-guards";
import { definition, uuid } from "./question-regression-fixtures";

const expected = process.env.OPENAPPLY_QUEUE_EXPERIENCE_DATABASE;
const source = process.env.OPENAPPLY_QUEUE_EXPERIENCE_SOURCE_DATABASE;
const url = new URL(process.env.DATABASE_URL ?? "");
assert.match(expected ?? "", /^apply_e2e_[a-f0-9]{12}$/);
assert.match(source ?? "", /^apply_e2e_[a-f0-9]{12}$/);
assert.notEqual(expected, source);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "15433");
assert.equal(url.pathname, `/${expected}`);
assert.equal(process.env.OPENAPPLY_MODEL_BUDGET, '{"maxRequests":0}');
assert.equal(process.env.OPENAPPLY_QUEUE_MODEL_APPROVAL, "");
assert.equal(process.env.OPENAPPLY_PREPARATION_MODEL_APPROVAL, "");
const mode = process.argv[2];
assert.ok(mode === "seed" || mode === "ui-login");
let stage = "identity";
let externalRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async () => {
    externalRequests++;
    throw new Error("Network is disabled in the synthetic UI fixture.");
  },
  { preconnect: originalFetch.preconnect },
) as typeof fetch;

async function run() {
  const [identity] = await db.$queryRaw<{ database: string; directory: string }[]>`
    SELECT current_database() AS database, current_setting('data_directory') AS directory`;
  assert.equal(identity?.database, expected);
  assert.equal(identity?.directory, "/var/lib/postgresql/mvp");
  const email = process.env.OPENAPPLY_QUEUE_EXPERIENCE_EMAIL;
  const password = process.env.OPENAPPLY_QUEUE_EXPERIENCE_PASSWORD;
  assert.ok(typeof email === "string" && email.endsWith("@questions.example.test"));
  assert.ok(password);
  if (mode === "ui-login") {
    stage = "clone login";
    const user = await db.user.findFirstOrThrow({
      where: {
        id: process.env.OPENAPPLY_QUEUE_EXPERIENCE_USER,
        email,
        firstName: "Questions",
        lastName: "Fixture",
      },
    });
    await db.user.update({
      where: { id: user.id },
      data: syntheticLoginUpdate(await Bun.password.hash(password)),
    });
    return { passed: true, mode, externalRequests, seededApplications: 0 };
  }
  stage = "retained source PDF";
  const sourceAttempt = await db.submissionAttempt.findFirstOrThrow({
    where: {
      checkpointId: process.env.OPENAPPLY_QUEUE_EXPERIENCE_CHECKPOINT,
      userId: process.env.OPENAPPLY_QUEUE_EXPERIENCE_SOURCE_USER,
    },
  });
  const checkpoint = submissionCheckpointSchema.parse(sourceAttempt.checkpoint);
  const root = path.resolve(env.STORAGE_ROOT, "application-submissions");
  const bytes = await readFile(submissionPdfPath(root, sourceAttempt.userId, checkpoint.resume));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checkpoint.resume.sha256);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    await db.user.count({ where: { email } }),
    0,
    "Seed account already exists; replay its preserved evidence instead.",
  );
  stage = "synthetic account";
  const user = await db.user.create({
    data: {
      email,
      username: uuid(),
      firstName: "Questions",
      lastName: "Fixture",
      emailVerified: true,
      passwordHash: await Bun.password.hash(password),
      queuePolicy: { create: {} },
      telegramSettings: { create: {} },
      pilotState: { create: {} },
    },
  });
  stage = "synthetic campaign";
  const campaign = await db.campaign.create({
    data: {
      userId: user.id,
      query: "Phase 9 synthetic UI",
      source: "apply",
      status: "in_progress",
    },
  });
  const specs = [
    {
      key: "control",
      title: "Phase 9 queued control",
      status: "approved" as const,
      state: "queued" as const,
    },
    {
      key: "blocked",
      title: "Phase 9 blocked questions",
      status: "needs_user" as const,
      state: "needs_user" as const,
    },
    {
      key: "submitted",
      title: "Phase 9 synthetic submitted record",
      status: "applied" as const,
      state: "submitted" as const,
    },
    {
      key: "frame-a",
      title: "Phase 9 simulated worker A",
      status: "approved" as const,
      state: "queued" as const,
    },
    {
      key: "frame-b",
      title: "Phase 9 simulated worker B",
      status: "approved" as const,
      state: "queued" as const,
    },
  ];
  const jobs = [];
  const items = [];
  for (const spec of specs) {
    stage = `synthetic job ${spec.key}`;
    const job = await db.job.create({
      data: {
        campaignId: campaign.campaignId,
        key: spec.key,
        title: spec.title,
        company: "Synthetic Queue Fixture",
        url: `https://queue-ui.example.test/${user.id}/${spec.key}`,
        status: spec.status,
      },
    });
    jobs.push(job);
    stage = `synthetic work ${spec.key}`;
    items.push(
      await db.workItem.create({
        data: {
          userId: user.id,
          kind: "application",
          source: "user",
          provider: "codex",
          state: spec.state,
          identity: `job:${job.id}`,
          jobId: job.id,
          jobKey: job.key,
          campaignId: campaign.campaignId,
          title: job.title,
          company: job.company,
          reason: spec.state === "needs_user" ? "Two confirmed answers are required." : null,
          // The observer simulates activity for these queued rows without any execution or lease.
          ...(spec.key.startsWith("frame-")
            ? { reason: "Queued fixture for simulated browser UI; no worker was started." }
            : {}),
          ...(spec.state === "submitted" ? { finishedAt: new Date() } : {}),
        },
      }),
    );
  }
  const [control, blocked, submitted, frameA, frameB] = items;
  const [controlJob, blockedJob, submittedJob] = jobs;
  assert.ok(
    control && blocked && submitted && frameA && frameB && controlJob && blockedJob && submittedJob,
  );
  stage = "synthetic recorded activity";
  for (const item of [control, frameA, frameB])
    await db.workEvent.create({
      data: {
        workItemId: item.id,
        eventId: uuid(),
        payloadHash: "0".repeat(64),
        kind: "activity",
        content: `Synthetic recorded activity for ${item.title}. No model execution.`,
      },
    });
  stage = "canonical attention";
  const questions = new ApplicationQuestionService(db);
  await questions.observe(
    user.id,
    blockedJob.id,
    {
      requestId: uuid(),
      expectedCollectionVersion: 0,
      source: "browser_dom",
      sourceUrl: blockedJob.url,
      coverage: "complete",
      collectorVersion: "phase9-ui-fixture",
      definitions: [
        definition("authorization", "Are you authorized to work in Canada?"),
        definition("relocation", "Are you willing to relocate for this synthetic role?"),
      ],
    },
    "agent",
  );
  const operational = await db.pilotQuestion.create({
    data: {
      userId: user.id,
      kind: "question",
      prompt: "Synthetic operational request for the Queue UI gate.",
      subjectType: "job",
      subjectId: blockedJob.id,
      deepLink: `/campaigns/${campaign.campaignId}?job=${blockedJob.key}`,
    },
  });
  stage = "immutable synthetic submission";
  const resume = await saveSubmissionPdf(
    root,
    user.id,
    submittedJob.id,
    new File([new Uint8Array(bytes)], "synthetic-submitted-resume.pdf", {
      type: "application/pdf",
    }),
  );
  const submission = applicationSubmissionRecordSchema.parse({
    version: 1,
    fields: [
      {
        id: "fixture",
        label: "Fixture statement",
        type: "text",
        value: "Synthetic evidence only; no employer submission occurred.",
      },
    ],
    confirmation: {
      url: `${submittedJob.url}/confirmation`,
      text: "Synthetic UI receipt; no employer was contacted.",
      observedAt: new Date().toISOString(),
      reference: `SYNTHETIC-${submittedJob.id}`,
    },
    resume,
    previous: [],
  });
  const application = await db.application.create({
    data: {
      userId: user.id,
      url: submittedJob.url,
      title: submittedJob.title,
      company: submittedJob.company,
      campaignId: campaign.campaignId,
      source: "apply",
      status: "applied",
      submission,
    },
  });
  await db.workItem.update({
    where: { id: submitted.id },
    data: { applicationId: application.id },
  });
  const counts = await countNeedsYou(db, user.id);
  const summary = await new WorkQueueService(db).summary(user.id);
  assert.equal(counts.total, 3);
  assert.equal(summary.needsUser, 1);
  assert.equal(await db.workExecution.count({ where: { userId: user.id } }), 0);
  assert.equal(await db.submissionAttempt.count({ where: { userId: user.id } }), 0);
  assert.equal(externalRequests, 0);
  return {
    passed: true,
    mode: "model-free-queue-experience-seed",
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    externalRequests,
    seededApplications: 1,
    executionsCreated: 0,
    evidence:
      "Synthetic saved state and copied fixture PDF only. No application acceptance or live worker execution.",
    ui: {
      userId: user.id,
      loginEmail: email,
      provider: "codex",
      campaignId: campaign.campaignId,
      controlId: control.id,
      controlJobId: controlJob.id,
      controlJobKey: controlJob.key,
      controlTitle: control.title,
      blockedId: blocked.id,
      submittedId: submitted.id,
      applicationId: application.id,
      receiptReference: submission.confirmation.reference,
      pdfSha256: resume.sha256,
      operationalQuestionId: operational.id,
      itemIds: items.map((item) => item.id),
      needsYouTotal: counts.total,
      blockedWorkCount: summary.needsUser,
      workers: [frameA, frameB].map((item, i) => ({
        workItemId: item.id,
        workerId: uuid(),
        executionId: uuid(),
        browserSessionId: uuid(),
        slot: i + 1,
        state: "running",
      })),
    },
  };
}
try {
  const result = await run();
  await writeFile(process.env.OPENAPPLY_QUEUE_EXPERIENCE_REPORT!, JSON.stringify(result), {
    flag: "wx",
  });
  console.log(JSON.stringify({ passed: true, mode, externalRequests }));
} catch (error) {
  await writeFile(
    process.env.OPENAPPLY_QUEUE_EXPERIENCE_REPORT!,
    JSON.stringify({ passed: false, stage, error: databaseDiagnostic(error) }),
    { flag: "wx" },
  );
  console.log(JSON.stringify({ passed: false, stage }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  await db.$disconnect();
}
