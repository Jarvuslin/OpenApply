import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/common/database/prisma.client";
import { env } from "../src/env";
import { OriginalResumeSource } from "../src/modules/scoring/original-source";
import { ScoringService } from "../src/modules/scoring/scoring.service";
import { assertSubmissionLease } from "../src/modules/work-queue/submission-fence";
import { WorkQueueClaimService } from "../src/modules/work-queue/work-queue.claim";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import {
  artifacts,
  claims,
  concurrencyFixture,
  limits,
  queue,
} from "./concurrency-regression-fixtures";
import { safeConcurrencyFailure, syntheticLoginUpdate } from "./concurrency-regression-guards";
import { documentFixture, preparation, questions } from "./preparation-regression-fixtures";
import { uuid } from "./question-regression-fixtures";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_CONCURRENCY_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.pathname !== `/${expected}` ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433"
)
  throw new Error("Concurrency regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity";
function report(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  if (process.env.OPENAPPLY_CONCURRENCY_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_CONCURRENCY_TEST_REPORT, text);
  console.log(text);
}
async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push(name);
}

async function run() {
  const identity = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
  assert.equal(identity[0]?.database, expected);
  assert.equal(identity[0]?.directory, "/var/lib/postgresql/mvp");
  if (process.argv[2] === "ui-login") {
    stage = "synthetic clone login reset";
    const id = process.env.OPENAPPLY_CONCURRENCY_TEST_UI_USER,
      email = process.env.OPENAPPLY_CONCURRENCY_TEST_LOGIN_EMAIL,
      password = process.env.OPENAPPLY_CONCURRENCY_TEST_PASSWORD;
    assert.ok(id && email?.endsWith("@questions.example.test") && password);
    const user = await db.user.findFirstOrThrow({
      where: { id, email, firstName: "Questions", lastName: "Fixture" },
    });
    await db.user.update({
      where: { id: user.id },
      data: syntheticLoginUpdate(await Bun.password.hash(password)),
    });
    report({
      passed: true,
      mode: "ui-login",
      checks: ["verified disposable synthetic clone login reset"],
    });
    return;
  }
  await check(
    "policy initialization, human authority, revision CAS and lost-ack replay",
    async () => {
      const f = await concurrencyFixture("Policy");
      const initial = await limits.read(f.user.id);
      assert.equal(initial.revision, 1);
      assert.equal(initial.maxConcurrentWorkers, 1);
      const input = {
        requestId: uuid(),
        expectedRevision: 1,
        maxConcurrentWorkers: 2,
        dailyApplicationCap: 11,
        companyApplicationCap: 4,
        companyWindowDays: 7,
        domainDelaySeconds: 45,
      };
      await assert.rejects(limits.update(f.user.id, input, "agent"));
      const result = await Promise.all([
        limits.update(f.user.id, input, "session_user"),
        limits.update(f.user.id, input, "session_user"),
      ]);
      assert.deepEqual(result[0], result[1]);
      assert.equal(result[0].revision, 2);
      await assert.rejects(
        limits.update(f.user.id, { ...input, requestId: uuid() }, "session_user"),
      );
      await assert.rejects(
        limits.update(f.user.id, { ...input, dailyApplicationCap: 12 }, "session_user"),
      );
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
    },
  );
  await check(
    "concurrent explicit claims grant three unique browser sessions and bounded slots",
    async () => {
      const f = await concurrencyFixture("Three workers");
      await f.policy();
      const results = await Promise.all(f.items.map((_, i) => claims.claim(f.user.id, f.input(i))));
      const active = results.flatMap((result) => (result.claim ? [result.claim] : []));
      assert.equal(active.length, 3);
      assert.equal(new Set(active.map((row) => row.ownership.slot)).size, 3);
      assert.equal(new Set(active.map((row) => row.ownership.browserSessionId)).size, 3);
      assert.equal(results.filter((result) => result.blockedReason === "capacity").length, 1);
      for (const row of active) assert.ok(row.execution.job?.url);
    },
  );
  await check(
    "claim request and live worker ownership are immutable and account scoped",
    async () => {
      const f = await concurrencyFixture("Identity");
      await f.policy();
      const input = f.input();
      const repeated = await Promise.all([
        claims.claim(f.user.id, input),
        claims.claim(f.user.id, input),
      ]);
      assert.deepEqual(repeated[0].claim?.ownership, repeated[1].claim?.ownership);
      await assert.rejects(claims.claim(f.user.id, { ...input, workItemId: f.items[1].id }));
      const other = await concurrencyFixture("Foreign");
      await assert.rejects(claims.claim(other.user.id, input));
      assert.equal(
        (await claims.claim(f.user.id, { ...input, requestId: uuid(), workItemId: f.items[1].id }))
          .blockedReason,
        "capacity",
      );
      const claim = repeated[0].claim;
      assert.ok(claim);
      await queue.finish(f.user.id, claim.item.id, {
        leaseToken: claim.leaseToken,
        status: "waiting",
      });
      assert.equal((await claims.claim(f.user.id, input)).blockedReason, "settled_request");
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 1);
    },
  );
  await check(
    "daily and company reservations serialize concurrent pre-model admissions",
    async () => {
      const f = await concurrencyFixture("Daily");
      await f.policy({ dailyApplicationCap: 2 });
      const results = await Promise.all(f.items.map((_, i) => claims.claim(f.user.id, f.input(i))));
      assert.equal(results.filter((row) => row.claim).length, 2);
      assert.equal(results.filter((row) => row.blockedReason === "daily_cap").length, 2);
      const g = await concurrencyFixture("Company");
      await g.policy({ companyApplicationCap: 1 });
      await db.job.updateMany({
        where: { campaignId: g.campaign.campaignId },
        data: { company: "Same Company Inc." },
      });
      const company = await Promise.all(g.items.map((_, i) => claims.claim(g.user.id, g.input(i))));
      assert.equal(company.filter((row) => row.claim).length, 1);
      assert.equal(company.filter((row) => row.blockedReason === "company_cap").length, 3);
    },
  );
  await check(
    "one live domain plus durable cooldown survives service restart and park",
    async () => {
      const f = await concurrencyFixture("Domain");
      await f.policy();
      await db.job.update({
        where: { id: f.jobs[1].id },
        data: { url: new URL("/jobs/other", f.jobs[0].url).href },
      });
      const first = (await claims.claim(f.user.id, f.input())).claim;
      assert.ok(first);
      assert.equal((await claims.claim(f.user.id, f.input(1))).blockedReason, "domain_busy");
      await queue.finish(f.user.id, first.item.id, {
        leaseToken: first.leaseToken,
        status: "waiting",
      });
      const execution = await db.workExecution.findUniqueOrThrow({
        where: { id: first.ownership.executionId },
      });
      assert.ok(execution.finishedAt && execution.releasedAt);
      assert.equal(execution.consumedAt, null);
      const restarted = new WorkQueueClaimService(
        db,
        new WorkQueueService(db),
        artifacts,
        new ScoringService(db, new OriginalResumeSource()),
      );
      assert.equal((await restarted.claim(f.user.id, f.input(1))).blockedReason, "domain_pacing");
      assert.ok((await restarted.claim(f.user.id, f.input(2))).claim);
    },
  );
  await check(
    "pause holds live capacity until acknowledgement and stale token never submits",
    async () => {
      const f = await concurrencyFixture("Pause");
      const first = (await claims.claim(f.user.id, f.input())).claim;
      assert.ok(first);
      await queue.control(f.user.id, first.item.id, "pause");
      assert.equal((await claims.claim(f.user.id, f.input(1))).blockedReason, "capacity");
      await assert.rejects(
        db.$transaction((tx) =>
          assertSubmissionLease(tx, f.user.id, f.jobs[0].id, first.item.id, first.leaseToken),
        ),
      );
      await queue.finish(f.user.id, first.item.id, {
        leaseToken: first.leaseToken,
        status: "waiting",
      });
      assert.ok((await claims.claim(f.user.id, f.input(1))).claim);
      await assert.rejects(
        db.$transaction((tx) =>
          assertSubmissionLease(tx, f.user.id, f.jobs[0].id, first.item.id, first.leaseToken),
        ),
      );
    },
  );
  await check(
    "ambiguous begin survives lease expiry, source deletion and new claim attempts",
    async () => {
      const f = await concurrencyFixture("Ambiguous");
      await f.policy({ dailyApplicationCap: 1 });
      const first = (await claims.claim(f.user.id, f.input())).claim;
      assert.ok(first);
      await db.submissionAttempt.create({
        data: {
          userId: f.user.id,
          jobId: f.jobs[0].id,
          originalUrl: f.jobs[0].url,
          canonicalUrl: f.jobs[0].url,
          startedAt: new Date(),
          checkpoint: { job: { company: f.jobs[0].company } },
          legacyOutcomeUnknown: true,
        },
      });
      await db.workItem.update({
        where: { id: first.item.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      assert.equal((await claims.claim(f.user.id, f.input(1))).blockedReason, "daily_cap");
      const execution = await db.workExecution.findUniqueOrThrow({
        where: { id: first.ownership.executionId },
      });
      assert.ok(execution.finishedAt && execution.consumedAt);
      assert.equal(execution.releasedAt, null);
      await db.job.delete({ where: { id: f.jobs[0].id } });
      assert.equal((await claims.claim(f.user.id, f.input(2))).blockedReason, "daily_cap");
      assert.equal(
        await db.submissionAttempt.count({ where: { userId: f.user.id, jobId: null } }),
        1,
      );
    },
  );
  await check(
    "account policy and owned source scope are checked again at submission fence",
    async () => {
      const f = await concurrencyFixture("Fence");
      await f.policy();
      const first = (await claims.claim(f.user.id, f.input())).claim;
      assert.ok(first);
      await db.$transaction((tx) =>
        assertSubmissionLease(tx, f.user.id, f.jobs[0].id, first.item.id, first.leaseToken),
      );
      await db.job.update({
        where: { id: f.jobs[0].id },
        data: { company: "A different employer" },
      });
      await assert.rejects(
        db.$transaction((tx) =>
          assertSubmissionLease(tx, f.user.id, f.jobs[0].id, first.item.id, first.leaseToken),
        ),
      );
      await db.job.update({ where: { id: f.jobs[0].id }, data: { company: f.jobs[0].company } });
      await claims.claim(f.user.id, f.input(1));
      await f.policy({ dailyApplicationCap: 1 });
      await assert.rejects(
        db.$transaction((tx) =>
          assertSubmissionLease(tx, f.user.id, f.jobs[0].id, first.item.id, first.leaseToken),
        ),
      );
    },
  );
  await check("existing campaign and Pilot caps include pre-submit held reservations", async () => {
    const f = await concurrencyFixture("Campaign cap");
    await f.policy();
    await db.campaign.update({
      where: { campaignId: f.campaign.campaignId },
      data: { config: { maxApplications: 1 } },
    });
    assert.ok((await claims.claim(f.user.id, f.input())).claim);
    assert.equal((await claims.claim(f.user.id, f.input(1))).blockedReason, "campaign_cap");
    const g = await concurrencyFixture("Pilot cap");
    await g.policy();
    await db.pilotState.create({
      data: { userId: g.user.id, running: true, instructionsConfig: { dailyApplyCap: 1 } },
    });
    await db.workItem.updateMany({ where: { userId: g.user.id }, data: { source: "pilot" } });
    assert.ok((await claims.claim(g.user.id, g.input())).claim);
    assert.equal((await claims.claim(g.user.id, g.input(1))).blockedReason, "pilot_limit");
  });
  await check(
    "real compiled PDF corruption becomes visible Needs-you before claiming",
    async () => {
      const f = await documentFixture("Preclaim PDF integrity");
      const item = (await f.enqueue()).items[0];
      assert.ok(item);
      const selected = await preparation.selectDocument(
        f.user.id,
        f.question.id,
        f.input,
        "session_user",
      );
      const pdf = path.resolve(
        env.STORAGE_ROOT,
        "resume-artifacts",
        f.user.id,
        f.resume.id,
        "base",
        f.artifact.revision,
        "resume.pdf",
      );
      const bytes = await readFile(pdf);
      try {
        await writeFile(pdf, Buffer.from("%PDF-corrupt-synthetic-test"));
        const result = await claims.claim(f.user.id, {
          requestId: uuid(),
          runtimeId: uuid(),
          workerId: uuid(),
          workItemId: item.id,
          capabilities: { isolatedBrowser: true },
        });
        assert.equal(result.blockedReason, "artifact_unavailable");
        assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
        assert.equal((await questions.count(f.user.id)).application, 1);
        assert.ok(
          (await db.applicationDocumentSelection.findUniqueOrThrow({ where: { id: selected.id } }))
            .invalidatedAt,
        );
      } finally {
        await writeFile(pdf, bytes);
      }
      await assert.rejects(queue.control(f.user.id, item.id, "resume"));
      await preparation.selectDocument(
        f.user.id,
        f.question.id,
        { ...f.input, requestId: uuid(), expectedSelectionId: selected.id },
        "session_user",
      );
      assert.equal((await questions.count(f.user.id)).application, 0);
    },
  );
  await check(
    "whole-queue estimates reserve joint domains and quotas without execution writes",
    async () => {
      const f = await concurrencyFixture("Estimate");
      await f.policy({ dailyApplicationCap: 2 });
      await db.job.update({
        where: { id: f.jobs[1].id },
        data: { url: new URL("/jobs/same-domain", f.jobs[0].url).href },
      });
      const before = await db.workItem.findMany({
        where: { userId: f.user.id },
        orderBy: { id: "asc" },
      });
      const estimate = await limits.estimate(f.user.id);
      assert.equal(estimate.counts.queuedApplications, 4);
      assert.equal(estimate.counts.eligibleNow, 2);
      assert.equal(estimate.counts.deferred, 2);
      assert.equal(estimate.usage.modelRequests, null);
      assert.equal(estimate.usage.proRemaining, null);
      assert.deepEqual(
        await db.workItem.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } }),
        before,
      );
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
    },
  );
  let ui: Record<string, unknown> | undefined;
  await check(
    "synthetic UI queue and persisted default policy contain no model execution",
    async () => {
      const email = process.env.OPENAPPLY_CONCURRENCY_TEST_LOGIN_EMAIL,
        password = process.env.OPENAPPLY_CONCURRENCY_TEST_PASSWORD;
      assert.ok(email?.endsWith("@questions.example.test") && password);
      const f = await concurrencyFixture("Concurrency UI fixture", 4, { email, password });
      assert.equal((await limits.read(f.user.id)).maxConcurrentWorkers, 1);
      assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
      ui = {
        userId: f.user.id,
        loginEmail: email,
        targetLimits: {
          maxConcurrentWorkers: 2,
          dailyApplicationCap: 11,
          companyApplicationCap: 4,
          companyWindowDays: 7,
          domainDelaySeconds: 45,
        },
      };
    },
  );
  report({ passed: true, checks, ui, modelRequests: 0, employerSubmissions: 0 });
}
run()
  .catch((error) => {
    report({
      passed: false,
      stage,
      checks,
      error: safeConcurrencyFailure(error),
    });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
