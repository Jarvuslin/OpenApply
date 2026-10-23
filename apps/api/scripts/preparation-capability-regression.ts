import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fitAssessmentSchema } from "@openapply/contracts/scoring";
import { Elysia } from "elysia";
import { hashToken } from "../src/common/auth";
import { db } from "../src/common/database/prisma.client";
import { HttpError } from "../src/common/errors";
import { intakePreparationController } from "../src/modules/intake-preparation/intake-preparation.controller";
import { IntakePreparationService } from "../src/modules/intake-preparation/intake-preparation.service";
import { JobIntakeService } from "../src/modules/job-intakes/job-intake.service";
import { ResumeArtifactService } from "../src/modules/resume/resume-artifact.service";
import { assertSubmissionLease } from "../src/modules/work-queue/submission-fence";
import { WorkQueueClaimService } from "../src/modules/work-queue/work-queue.claim";
import { workQueueController } from "../src/modules/work-queue/work-queue.controller";
import { WorkQueueReadService } from "../src/modules/work-queue/work-queue.read";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import { definition, uuid } from "./question-regression-fixtures";
import { scoring } from "./scoring-regression-fixtures";
import { scoredIntakeFixture } from "./telegram-regression-fixtures";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;

export async function verifyPreparationCapabilities(check: Check) {
  const f = await scoredIntakeFixture("Phase 9 isolated preparation capability");
  const service = new IntakePreparationService(db, scoring),
    intakes = new JobIntakeService(db, scoring),
    queue = new WorkQueueService(db);
  const claims = new WorkQueueClaimService(db, queue, new ResumeArtifactService(db), scoring),
    reads = new WorkQueueReadService(db, scoring);
  const prepareInput = {
    requestId: uuid(),
    expectedRevision: f.intake.revision,
    provider: "codex" as const,
  };
  const prepared = await intakes.prepare(f.user.id, f.intake.id, prepareInput, "session_user");
  assert.ok(prepared.workItemId);
  const workItemId = prepared.workItemId;
  const plan = await service.plan(f.user.id, workItemId);
  const input = {
    requestId: uuid(),
    runtimeId: uuid(),
    workerId: uuid(),
    workItemId,
    preparationSnapshotHash: plan.snapshotHash,
    capabilities: { isolatedBrowser: true as const },
  };
  const evidenceBefore = await db.submissionAttempt.count({ where: { userId: f.user.id } });

  await check(
    "explicit preparation persists an exact immutable scope and replay returns the same work",
    async () => {
      assert.deepEqual(
        await intakes.prepare(f.user.id, f.intake.id, prepareInput, "session_user"),
        prepared,
      );
      assert.equal(
        await db.workItem.count({ where: { userId: f.user.id, intent: "intake_prepare" } }),
        1,
      );
      assert.equal(plan.provider, "codex");
      assert.equal(plan.resumeId, f.resume.id);
      assert.equal(plan.jobId, f.job.id);
      assert.equal(plan.intakeRevision, prepared.revision);
      assert.equal(
        (await db.jobIntake.findUniqueOrThrow({ where: { id: f.intake.id } })).decision,
        "pending",
      );
      await assert.rejects(service.plan(uuid(), workItemId), { status: 404 });
      await assert.rejects(
        claims.claim(f.user.id, { ...input, preparationSnapshotHash: undefined }),
      );
      await assert.rejects(
        claims.claim(f.user.id, { ...input, preparationSnapshotHash: "0".repeat(64) }),
      );
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
    },
  );
  const claim = (await claims.claim(f.user.id, input)).claim;
  assert.ok(claim?.execution.preparation);
  const token = `Bearer ${claim.execution.preparation.apiToken}`;
  assert.deepEqual(claim.execution.preparation.snapshot, plan);
  assert.equal(claim.execution.job, null);
  const app = new Elysia()
    .onError(({ error, set }) => {
      set.status = error instanceof HttpError ? error.status : 500;
      return {
        code: error instanceof HttpError ? error.code : "REGRESSION_ERROR",
        message: "Request rejected",
      };
    })
    .group("/api", (api) => api.use(workQueueController).use(intakePreparationController))
    .compile();
  async function request(path: string, authorization: string, method = "GET", body?: unknown) {
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  const pat = `synthetic_${uuid()}`;
  await db.apiToken.create({
    data: {
      userId: f.user.id,
      name: "Synthetic preparation auth boundary",
      tokenHash: hashToken(pat),
    },
  });

  await check(
    "HTTP capability routes reject account PATs and ordinary account routes reject prep tokens",
    async () => {
      assert.equal((await request("/intake-preparation/context", token)).status, 200);
      assert.equal((await request("/intake-preparation/context", `Bearer ${pat}`)).status, 401);
      assert.equal((await request("/work-queue/summary", token)).status, 401);
      assert.equal(
        (
          await request("/work-queue/enqueue", token, "POST", {
            idempotencyKey: uuid(),
            jobIds: [f.job.id],
            source: "user",
            provider: "codex",
          })
        ).status,
        401,
      );
      assert.equal(
        (await request("/intake-preparation/context", `Bearer prep.${uuid()}.${claim.leaseToken}`))
          .status,
        404,
      );
      assert.equal(
        (await request("/intake-preparation/context", `Bearer prep.${workItemId}.${uuid()}`))
          .status,
        409,
      );
      await assert.rejects(
        db.$transaction((tx) =>
          assertSubmissionLease(tx, f.user.id, f.job.id, workItemId, claim.leaseToken),
        ),
        { status: 409 },
      );
    },
  );

  await check(
    "live preparation writes only its posting and agent observations without answering or submitting",
    async () => {
      const initial = await service.context(token);
      await service.posting(token, { description: initial.job.description });
      const observed = await service.observe(token, {
        requestId: uuid(),
        expectedCollectionVersion: initial.questions.collectionVersion,
        source: "browser_dom",
        sourceUrl: f.job.url,
        coverage: "complete",
        collectorVersion: "phase9-synthetic-read-only",
        definitions: [definition()],
      });
      assert.equal(observed.questions.length, 1);
      assert.equal(observed.questions[0].answer, null);
      const collection = await db.jobQuestionCollection.findFirstOrThrow({
        where: { jobId: f.job.id, userId: f.user.id },
      });
      assert.equal(collection.authorship, "agent");
      assert.equal(await db.applicationQuestionAnswer.count({ where: { userId: f.user.id } }), 0);
      const job = await db.job.findUniqueOrThrow({ where: { id: f.job.id } });
      assert.equal(job.status, "pending");
      assert.equal(job.intakeDecisionRequired, true);
      assert.equal(job.humanApprovalRequired, true);
      const source = await service.context(token);
      assert.equal(source.questions.collectionVersion, observed.collectionVersion);
    },
  );

  await check(
    "preserved synthetic judgments pass through the scoped fit transaction and unchanged fit is reused",
    async () => {
      const corpus = JSON.parse(
        await readFile(
          new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
          "utf8",
        ),
      ) as { cases: { fixture: string; historical: { assessment: unknown } }[] };
      const historical = fitAssessmentSchema.parse(
        corpus.cases.find((entry) => entry.fixture === f.job.key)!.historical.assessment,
      );
      const current = await service.context(token);
      assert.ok(current.fit);
      const judgments = {
        basis: current.fit.basis,
        assessments: historical.assessments.map(
          ({ criterionId, category, rating, evidence, explanation }) => ({
            criterionId,
            category,
            rating,
            evidence,
            explanation,
          }),
        ),
        roleMatch: historical.roleMatch,
        preferenceChecks: historical.preferenceChecks,
      };
      const saved = await service.fit(token, judgments);
      const unchanged = await db.job.findUniqueOrThrow({ where: { id: f.job.id } });
      assert.deepEqual(await service.fit(token, judgments), saved);
      assert.deepEqual(await db.job.findUniqueOrThrow({ where: { id: f.job.id } }), unchanged);
      assert.equal(unchanged.status, "pending");
      assert.equal(unchanged.intakeDecisionRequired, true);
    },
  );

  await check(
    "every capability read revalidates original bytes, preferences, job and intake revision",
    async () => {
      const original = await readFile(f.sourceFile);
      try {
        await writeFile(
          f.sourceFile,
          Buffer.concat([original, Buffer.from("\nSource changed after approval.")]),
        );
        await assert.rejects(service.context(token), { status: 409 });
      } finally {
        await writeFile(f.sourceFile, original);
      }
      const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
      try {
        await db.user.update({
          where: { id: f.user.id },
          data: { preferredLocations: '["Changed"]' },
        });
        await assert.rejects(service.context(token), { status: 409 });
      } finally {
        await db.user.update({
          where: { id: f.user.id },
          data: { preferredLocations: user.preferredLocations },
        });
      }
      try {
        await db.jobIntake.update({
          where: { id: f.intake.id },
          data: { revision: { increment: 1 } },
        });
        await assert.rejects(service.context(token), { status: 409 });
      } finally {
        await db.jobIntake.update({
          where: { id: f.intake.id },
          data: { revision: plan.intakeRevision },
        });
      }
      try {
        await db.job.update({ where: { id: f.job.id }, data: { url: `${f.job.url}?different=1` } });
        await assert.rejects(service.context(token), { status: 409 });
      } finally {
        await db.job.update({ where: { id: f.job.id }, data: { url: f.job.url } });
      }
      assert.equal((await service.context(token)).snapshot.snapshotHash, plan.snapshotHash);
    },
  );

  await check(
    "observer checks exact owner and execution without renewing and refuses ended frames",
    async () => {
      const query = {
        executionId: claim.ownership.executionId,
        browserSessionId: claim.ownership.browserSessionId,
      };
      const before = await db.workItem.findUniqueOrThrow({ where: { id: workItemId } });
      assert.equal((await reads.observer(f.user.id, workItemId, query)).active, true);
      assert.deepEqual(await db.workItem.findUniqueOrThrow({ where: { id: workItemId } }), before);
      await assert.rejects(reads.observer(uuid(), workItemId, query), { status: 404 });
      await assert.rejects(
        reads.observer(f.user.id, workItemId, { ...query, browserSessionId: uuid() }),
        { status: 404 },
      );
      await queue.finish(f.user.id, workItemId, {
        leaseToken: claim.leaseToken,
        status: "completed",
      });
      assert.equal((await reads.observer(f.user.id, workItemId, query)).active, false);
      await assert.rejects(service.context(token), { status: 409 });
      await assert.rejects(queue.control(f.user.id, workItemId, "resume"), { status: 409 });
      await assert.rejects(service.plan(f.user.id, workItemId), { status: 409 });
    },
  );

  await check(
    "requested-set priority preserves eligibility, exact ownership and all persisted execution state",
    async () => {
      const apps = (
        await queue.enqueue(f.user.id, {
          idempotencyKey: uuid(),
          jobIds: f.jobs.slice(1).map((job) => job.id),
          source: "user",
          provider: "codex",
        })
      ).items;
      const [first, priority, excluded] = apps;
      await db.workItem.update({
        where: { id: priority.id },
        data: { priorityRequestedAt: new Date(20) },
      });
      await db.workItem.update({
        where: { id: excluded.id },
        data: { priorityRequestedAt: new Date(10) },
      });
      const before = await db.workItem.findMany({
        where: { userId: f.user.id },
        orderBy: { id: "asc" },
      });
      const result = await reads.ordered(f.user.id, { workItemIds: [first.id, priority.id] });
      assert.deepEqual(
        result.items.map((item) => item.workItemId),
        [priority.id, first.id],
      );
      assert.ok(result.items.every((item) => item.eligible));
      assert.deepEqual(
        await db.workItem.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } }),
        before,
      );
      await assert.rejects(reads.ordered(f.user.id, { workItemIds: [first.id, uuid()] }), {
        status: 404,
      });
      await db.workItem.update({ where: { id: priority.id }, data: { state: "paused" } });
      assert.equal(
        (await reads.ordered(f.user.id, { workItemIds: [priority.id, first.id] })).items[0]
          .eligible,
        false,
      );
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 1);
    },
  );

  await check(
    "new explicit preparation supersedes old payloads and skip revokes the exact live capability",
    async () => {
      const old = await db.workItem.create({
        data: {
          userId: f.user.id,
          kind: "pilot_task",
          source: "user",
          provider: "codex",
          identity: `legacy-prep:${uuid()}`,
          intent: "intake_prepare",
          campaignId: f.job.campaignId,
          title: "Unsupported legacy preparation",
          payload: { intakeId: f.intake.id, jobIds: [f.job.id] },
        },
      });
      await assert.rejects(service.plan(f.user.id, old.id), { status: 409 });
      await assert.rejects(
        claims.claim(f.user.id, { ...input, requestId: uuid(), workItemId: old.id }),
        { status: 409 },
      );
      const next = await intakes.prepare(
        f.user.id,
        f.intake.id,
        { requestId: uuid(), expectedRevision: prepared.revision, provider: "codex" },
        "session_user",
      );
      assert.ok(next.workItemId && next.workItemId !== workItemId);
      assert.equal(
        (await db.workItem.findUniqueOrThrow({ where: { id: old.id } })).state,
        "cancelled",
      );
      const nextPlan = await service.plan(f.user.id, next.workItemId);
      const newClaim = (
        await claims.claim(f.user.id, {
          ...input,
          requestId: uuid(),
          workerId: uuid(),
          workItemId: next.workItemId,
          preparationSnapshotHash: nextPlan.snapshotHash,
        })
      ).claim;
      assert.ok(newClaim?.execution.preparation);
      await intakes.decide(
        f.user.id,
        f.intake.id,
        { requestId: uuid(), expectedRevision: next.revision, decision: "skip" },
        "session_user",
      );
      await assert.rejects(service.context(`Bearer ${newClaim.execution.preparation.apiToken}`), {
        status: 409,
      });
      await queue.finish(f.user.id, next.workItemId, {
        leaseToken: newClaim.leaseToken,
        status: "cancelled",
      });
      assert.equal(
        await db.submissionAttempt.count({ where: { userId: f.user.id } }),
        evidenceBefore,
      );
      assert.equal(await db.application.count({ where: { userId: f.user.id } }), 0);
    },
  );
  return {
    userId: f.user.id,
    syntheticClaims: await db.workExecution.count({ where: { userId: f.user.id } }),
    questionCollections: await db.jobQuestionCollection.count({ where: { userId: f.user.id } }),
    scoredJobs: await db.job.count({
      where: { campaign: { userId: f.user.id }, matchScore: { not: null } },
    }),
  };
}
