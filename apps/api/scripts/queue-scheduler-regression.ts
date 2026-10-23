import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fitAssessmentSchema, scoreAssessmentInputSchema } from "@openapply/contracts/scoring";
import { db } from "../src/common/database/prisma.client";
import { container } from "../src/common/di/container";
import { ApplicationRulesService } from "../src/modules/application-rules/application-rules.service";
import { PilotService } from "../src/modules/pilot/pilot.service";
import { PilotSearchService } from "../src/modules/pilot/search.service";
import { WorkQueueSchedulerService } from "../src/modules/work-queue/work-queue.scheduler";
import { scoring, scoringFixture, uuid } from "./scoring-regression-fixtures";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;

export async function verifyQueueScheduler(check: Check) {
  const scheduler = container.resolve(WorkQueueSchedulerService);
  const pilot = new PilotService(db);
  const rules = new ApplicationRulesService(db);
  const searches = new PilotSearchService(db);
  const f = await scoringFixture("Automatic admission", { email: `${uuid()}@queue.example.test` });
  const [healthy, excluded, capped, paused] = f.jobs;
  const config = { dailyApplyCap: 10, minScore: 60 };
  await db.pilotState.create({
    data: {
      userId: f.user.id,
      instructionsGoals: "Synthetic queue admission only",
      instructionsConfig: config,
    },
  });
  // Prevent the agenda's unrelated fire-and-forget digest from outliving this bounded test.
  await db.pilotJournalEntry.create({
    data: { userId: f.user.id, kind: "digest", summary: "Synthetic digest already accounted for." },
  });
  assert.equal(await db.emailAccount.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await db.pushSubscription.count({ where: { userId: f.user.id } }), 0);
  const corpus = JSON.parse(
    await readFile(
      new URL("../../../scripts/scoring-regression/fixtures/phase1-g.json", import.meta.url),
      "utf8",
    ),
  ) as { cases: { fixture: string; historical: { assessment: unknown } }[] };
  for (const job of f.jobs) {
    const reference = fitAssessmentSchema.parse(
      corpus.cases.find((entry) => entry.fixture === job.key)!.historical.assessment,
    );
    const context = await scoring.context(f.user.id, {
      campaignId: job.campaignId,
      jobKey: job.key,
    });
    const result = await scoring.scoreJobFit(
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
    assert.ok(result.score >= 60);
  }
  await db.job.update({ where: { id: healthy.id }, data: { status: "pending" } });
  await db.job.update({
    where: { id: capped.id },
    data: { status: "skipped", skipReason: "Reserved for cap assertion" },
  });
  const pausedCampaign = await db.campaign.create({
    data: {
      userId: f.user.id,
      query: "Paused admission fixture",
      source: "apply",
      status: "paused",
      config: { resumeId: f.resume.id },
    },
  });
  await db.job.update({
    where: { id: paused.id },
    data: { campaignId: pausedCampaign.campaignId },
  });
  const exclusion = await rules.exclude(
    f.user.id,
    { requestId: uuid(), expectedRevision: 0, company: excluded.company },
    "session_user",
  );
  const other = await db.user.create({
    data: {
      email: `${uuid()}@queue.example.test`,
      username: uuid(),
      firstName: "Queue",
      lastName: "Fixture",
    },
  });
  const foreignCampaign = await db.campaign.create({
    data: { userId: other.id, source: "apply", query: "Foreign admission fixture" },
  });
  const foreign = await db.job.create({
    data: {
      campaignId: foreignCampaign.campaignId,
      key: "foreign",
      title: "Foreign approved job",
      company: "Other owner",
      url: "https://queue.example.test/foreign",
      status: "approved",
    },
  });
  const nextCycle = () =>
    db.pilotState.update({ where: { userId: f.user.id }, data: { lastCycleAt: null } });

  await check(
    "automatic scheduler promotes current saved evidence and admits only eligible owned jobs",
    async () => {
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 0 });
      assert.equal(
        (await db.job.findUniqueOrThrow({ where: { id: healthy.id } })).status,
        "pending",
      );
      await pilot.start(f.user.id);
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 1 });
      const items = await db.workItem.findMany({ where: { userId: f.user.id } });
      assert.equal(items.length, 1);
      assert.equal(items[0].jobId, healthy.id);
      assert.equal(items[0].kind, "application");
      assert.equal(items[0].source, "pilot");
      assert.equal(items[0].state, "queued");
      assert.equal(items[0].provider, "claude");
      assert.equal(
        (await db.job.findUniqueOrThrow({ where: { id: healthy.id } })).status,
        "approved",
      );
      for (const job of [excluded, paused, foreign])
        assert.equal(await db.workItem.count({ where: { jobId: job.id } }), 0);
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 0 });
      await nextCycle();
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 0 });
      assert.equal(await db.workItem.count({ where: { userId: f.user.id } }), 1);
    },
  );

  await check(
    "automatic admission observes caps and Undo without retrying existing failed work",
    async () => {
      await db.job.update({
        where: { id: capped.id },
        data: { status: "approved", skipReason: null },
      });
      await db.pilotState.update({
        where: { userId: f.user.id },
        data: { lastCycleAt: null, instructionsConfig: { ...config, dailyApplyCap: 0 } },
      });
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 0 });
      assert.equal(await db.workItem.count({ where: { jobId: capped.id } }), 0);
      await db.job.update({
        where: { id: capped.id },
        data: { status: "skipped", skipReason: "Cap assertion complete" },
      });
      await db.pilotState.update({
        where: { userId: f.user.id },
        data: { lastCycleAt: null, instructionsConfig: config },
      });
      await rules.undo(
        f.user.id,
        exclusion.id,
        { requestId: uuid(), expectedRevision: exclusion.revision },
        "session_user",
      );
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 1 });
      const item = await db.workItem.findUniqueOrThrow({ where: { jobId: excluded.id } });
      await db.workItem.update({
        where: { id: item.id },
        data: { state: "failed", reason: "Synthetic pre-execution failure" },
      });
      await nextCycle();
      assert.deepEqual(await scheduler.schedule(f.user.id, "claude"), { enqueued: 0 });
      assert.equal(
        (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
        "failed",
      );
    },
  );

  await check(
    "saved due search admission deduplicates a failed generation without executing discovery",
    async () => {
      await db.pilotState.create({
        data: {
          userId: other.id,
          instructionsGoals: "Synthetic saved search only",
          instructionsConfig: config,
        },
      });
      await db.pilotJournalEntry.create({
        data: {
          userId: other.id,
          kind: "digest",
          summary: "Synthetic digest already accounted for.",
        },
      });
      await db.job.update({
        where: { id: foreign.id },
        data: { status: "skipped", skipReason: "Ownership assertion complete" },
      });
      const search = await searches.create(other.id, {
        query: "Synthetic software role",
        reason: "Test saved cadence without network",
      });
      await pilot.start(other.id);
      assert.deepEqual(await scheduler.schedule(other.id, "claude"), { enqueued: 1 });
      const item = await db.workItem.findFirstOrThrow({
        where: { userId: other.id, intent: "search" },
      });
      assert.equal(item.kind, "pilot_task");
      assert.equal(item.source, "pilot");
      assert.equal((item.payload as { searchId: string }).searchId, search.id);
      await db.workItem.update({
        where: { id: item.id },
        data: { state: "failed", reason: "Synthetic discovery not executed" },
      });
      await db.pilotState.update({ where: { userId: other.id }, data: { lastCycleAt: null } });
      assert.deepEqual(await scheduler.schedule(other.id, "claude"), { enqueued: 0 });
      assert.equal(await db.workItem.count({ where: { userId: other.id } }), 1);
      assert.equal(
        (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
        "failed",
      );
    },
  );

  const owners = [f.user.id, other.id];
  const measurements = {
    workItems: await db.workItem.count({ where: { userId: { in: owners } } }),
    executions: await db.workExecution.count({ where: { userId: { in: owners } } }),
    applications: await db.application.count({ where: { userId: { in: owners } } }),
    submissionAttempts: await db.submissionAttempt.count({ where: { userId: { in: owners } } }),
    emailAccounts: await db.emailAccount.count({ where: { userId: { in: owners } } }),
    pushSubscriptions: await db.pushSubscription.count({ where: { userId: { in: owners } } }),
  };
  assert.deepEqual(measurements, {
    workItems: 3,
    executions: 0,
    applications: 0,
    submissionAttempts: 0,
    emailAccounts: 0,
    pushSubscriptions: 0,
  });
  await pilot.stop(f.user.id);
  await pilot.stop(other.id);
  return {
    ...measurements,
    evidence:
      "Preserved synthetic judgments, current deterministic scoring basis; no model execution.",
  };
}
