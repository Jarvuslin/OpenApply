import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "../src/common/database/prisma.client";
import { assertSubmissionLease } from "../src/modules/work-queue/submission-fence";
import { verifyQueueScheduler } from "./queue-scheduler-regression";
import { regressionQueue } from "./regression-queue";
import { safeTelegramFailure } from "./telegram-regression-errors";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_QUEUE_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433" ||
  url.pathname !== `/${expected}`
)
  throw new Error("Queue regression requires its explicitly created disposable database.");
const queue = regressionQueue(db);
const checks: string[] = [];
let stage = "database identity";
let externalRequests = 0;
let blockedProcessAttempts = 0;
const fetchBefore = globalThis.fetch;
const spawnBefore = Bun.spawn;
const spawnSyncBefore = Bun.spawnSync;
const uuid = () => crypto.randomUUID();

function report(result: Record<string, unknown>) {
  const text = JSON.stringify({ ...result, externalRequests, blockedProcessAttempts });
  if (process.env.OPENAPPLY_QUEUE_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_QUEUE_TEST_REPORT, text);
  console.log(text);
}

async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push(name);
}

async function fixture(label: string) {
  const user = await db.user.create({
    data: {
      queuePolicy: { create: {} },
      email: `${uuid()}@queue.example.test`,
      username: uuid(),
      firstName: "Queue",
      lastName: "Fixture",
    },
  });
  const campaign = await db.campaign.create({
    data: { userId: user.id, query: label, source: "apply" },
  });
  const job = await db.job.create({
    data: {
      campaignId: campaign.campaignId,
      key: "test-job",
      title: label,
      company: "Synthetic Queue Fixture",
      url: `https://queue.example.test/jobs/${uuid()}`,
      status: "approved",
    },
  });
  const input = {
    idempotencyKey: uuid(),
    jobIds: [job.id],
    source: "user" as const,
    provider: "claude" as const,
  };
  const enqueue = () => queue.enqueue(user.id, input);
  return { user, campaign, job, input, enqueue };
}

async function leased(label: string) {
  const f = await fixture(label);
  await f.enqueue();
  const claim = await queue.claim(f.user.id);
  assert.ok(claim);
  return { ...f, claim };
}

async function fence(
  f: Awaited<ReturnType<typeof leased>>,
  itemId = f.claim.item.id,
  token = f.claim.leaseToken,
  jobId = f.job.id,
) {
  return db.$transaction((tx) => assertSubmissionLease(tx, f.user.id, jobId, itemId, token));
}

try {
  const identity = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database, current_setting('data_directory') AS directory`;
  assert.equal(identity[0]?.database, expected);
  assert.equal(identity[0]?.directory, "/var/lib/postgresql/mvp");
  assert.equal(await db.user.count(), 0);
  checks.push(stage);
  globalThis.fetch = Object.assign(
    async () => {
      externalRequests++;
      throw new Error("External fetch is disabled in queue regression.");
    },
    { preconnect: fetchBefore.preconnect },
  );
  const blocked = () => {
    blockedProcessAttempts++;
    throw new Error("Provider and child processes are disabled in queue regression.");
  };
  Bun.spawn = blocked as typeof Bun.spawn;
  Bun.spawnSync = blocked as typeof Bun.spawnSync;

  await check(
    "concurrent duplicate admission creates one work item and no conversation",
    async () => {
      const f = await fixture("Admission");
      const replies = await Promise.all([f.enqueue(), f.enqueue(), f.enqueue()]);
      assert.equal(new Set(replies.map((reply) => reply.items[0]?.id)).size, 1);
      assert.equal(await db.workItem.count({ where: { userId: f.user.id } }), 1);
      await assert.rejects(queue.enqueue(f.user.id, { ...f.input, provider: "codex" }));
      const other = await fixture("Other owner");
      await assert.rejects(queue.enqueue(other.user.id, { ...f.input, idempotencyKey: uuid() }));
      const retried = await queue.enqueue(f.user.id, { ...f.input, idempotencyKey: uuid() });
      assert.equal(retried.items[0]?.id, replies[0]?.items[0]?.id);
    },
  );

  await check("concurrent companions receive exactly one lease", async () => {
    const f = await fixture("Concurrent claims");
    await f.enqueue();
    const claims = await Promise.all([
      queue.claim(f.user.id),
      queue.claim(f.user.id),
      queue.claim(f.user.id),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(
      (await db.workItem.findFirstOrThrow({ where: { userId: f.user.id } })).attempts,
      1,
    );
  });

  await check(
    "submission fence rejects missing, foreign, mismatched and paused leases",
    async () => {
      const f = await leased("Lease fence");
      await fence(f);
      await assert.rejects(db.$transaction((tx) => assertSubmissionLease(tx, f.user.id, f.job.id)));
      await assert.rejects(fence(f, uuid()));
      await assert.rejects(fence(f, f.claim.item.id, uuid()));
      await assert.rejects(fence(f, f.claim.item.id, f.claim.leaseToken, uuid()));
      assert.equal((await queue.control(f.user.id, f.claim.item.id, "pause")).state, "stopping");
      await assert.rejects(fence(f));
      assert.equal(await queue.claim(f.user.id), null);
      assert.equal(
        (await queue.heartbeat(f.user.id, f.claim.item.id, f.claim.leaseToken)).state,
        "stopping",
      );
      assert.equal(
        (
          await queue.finish(f.user.id, f.claim.item.id, {
            leaseToken: f.claim.leaseToken,
            status: "cancelled",
          })
        ).state,
        "paused",
      );
      assert.equal((await queue.control(f.user.id, f.claim.item.id, "resume")).state, "queued");
    },
  );

  await check("progress is ordered and events are idempotent with redacted leases", async () => {
    const f = await leased("Progress");
    await assert.rejects(queue.progress(f.user.id, f.claim.item.id, f.claim.leaseToken, "filling"));
    assert.equal(
      (await queue.progress(f.user.id, f.claim.item.id, f.claim.leaseToken, "ready")).state,
      "ready",
    );
    assert.equal(
      (await queue.progress(f.user.id, f.claim.item.id, f.claim.leaseToken, "filling")).state,
      "filling",
    );
    const input = {
      leaseToken: f.claim.leaseToken,
      eventId: uuid(),
      kind: "activity" as const,
      content: `Synthetic progress ${f.claim.leaseToken}`,
    };
    const first = await queue.event(f.user.id, f.claim.item.id, input);
    assert.equal((await queue.event(f.user.id, f.claim.item.id, input)).id, first.id);
    assert.ok(!first.content.includes(f.claim.leaseToken));
    await assert.rejects(queue.event(f.user.id, f.claim.item.id, { ...input, content: "Changed" }));
    const result = await queue.finish(f.user.id, f.claim.item.id, {
      leaseToken: f.claim.leaseToken,
      status: "completed",
    });
    assert.equal(result.state, "needs_user");
    assert.equal(await db.application.count({ where: { userId: f.user.id } }), 0);
    assert.equal(await queue.claim(f.user.id), null);
  });

  await check("expired lease parks work without retry or another submit permission", async () => {
    const f = await leased("Expiry");
    await db.workItem.update({
      where: { id: f.claim.item.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await assert.rejects(fence(f));
    assert.equal(await queue.claim(f.user.id), null);
    const item = (await queue.detail(f.user.id, f.claim.item.id)).item;
    assert.equal(item.state, "needs_user");
    assert.equal(item.attempts, 1);
    await assert.rejects(queue.heartbeat(f.user.id, item.id, f.claim.leaseToken));
  });

  await check("begun and detached legacy attempts cannot be replayed", async () => {
    for (const legacy of [false, true]) {
      const f = await fixture(legacy ? "Legacy ambiguity" : "Begun ambiguity");
      await db.submissionAttempt.create({
        data: {
          userId: f.user.id,
          jobId: legacy ? null : f.job.id,
          originalUrl: `${f.job.url}?utm_source=fixture`,
          canonicalUrl: legacy ? null : f.job.url,
          legacyOutcomeUnknown: legacy,
          startedAt: legacy ? null : new Date(),
        },
      });
      const item = (await f.enqueue()).items[0];
      assert.ok(item);
      assert.equal(item.state, "needs_user");
      await assert.rejects(queue.control(f.user.id, item.id, "resume"));
      assert.equal(await queue.claim(f.user.id), null);
    }
  });

  await check(
    "recorded evidence wins a stop/failure race; receipt alone stays parked",
    async () => {
      for (const recorded of [false, true]) {
        const f = await leased(recorded ? "Recorded race" : "Receipt recovery");
        const application = recorded
          ? await db.application.create({
              data: {
                userId: f.user.id,
                campaignId: f.campaign.campaignId,
                url: f.job.url,
                title: f.job.title,
                company: f.job.company,
                source: "apply",
              },
            })
          : null;
        await db.submissionAttempt.create({
          data: {
            userId: f.user.id,
            jobId: f.job.id,
            originalUrl: f.job.url,
            canonicalUrl: f.job.url,
            startedAt: new Date(),
            receiptStoredAt: new Date(),
            recordedAt: recorded ? new Date() : null,
            applicationId: application?.id,
          },
        });
        if (recorded) await db.job.update({ where: { id: f.job.id }, data: { status: "applied" } });
        await queue.control(f.user.id, f.claim.item.id, "stop");
        const result = await queue.finish(f.user.id, f.claim.item.id, {
          leaseToken: f.claim.leaseToken,
          status: "failed",
          error: "Synthetic transport failure",
        });
        assert.equal(result.state, recorded ? "submitted" : "needs_user");
        assert.equal(result.applicationId, application?.id ?? null);
        await assert.rejects(queue.control(f.user.id, f.claim.item.id, "resume"));
        assert.equal(await queue.claim(f.user.id), null);
      }
    },
  );

  await check("campaign preparation preserves scope and cannot submit", async () => {
    const f = await fixture("Preparation");
    const input = { idempotencyKey: uuid(), action: "start" as const, provider: "claude" as const };
    const item = (await queue.campaign(f.user.id, f.campaign.campaignId, input)).items[0];
    assert.ok(item);
    assert.equal(
      (await queue.campaign(f.user.id, f.campaign.campaignId, input)).items[0]?.id,
      item.id,
    );
    const claim = await queue.claim(f.user.id);
    assert.ok(claim);
    assert.equal(claim.item.kind, "pilot_task");
    await assert.rejects(
      db.$transaction((tx) =>
        assertSubmissionLease(tx, f.user.id, f.job.id, claim.item.id, claim.leaseToken),
      ),
    );
    const other = await fixture("Scope isolation");
    await assert.rejects(
      queue.campaign(f.user.id, f.campaign.campaignId, {
        ...input,
        idempotencyKey: uuid(),
        jobIds: [other.job.id],
      }),
    );
  });

  stage = "prepare synthetic automatic admission fixtures";
  const automaticAdmission = await verifyQueueScheduler(check);
  stage = "seed isolated rendered UI fixtures";
  const loginEmail = process.env.OPENAPPLY_QUEUE_TEST_LOGIN_EMAIL;
  const password = process.env.OPENAPPLY_QUEUE_TEST_PASSWORD;
  assert.ok(loginEmail);
  assert.ok(loginEmail.endsWith("@queue.example.test"));
  assert.ok(password);
  const uiUser = await db.user.create({
    data: {
      queuePolicy: { create: {} },
      email: loginEmail,
      username: uuid(),
      firstName: "Queue",
      lastName: "Fixture",
      emailVerified: true,
      passwordHash: await Bun.password.hash(password),
    },
  });
  const uiCampaign = await db.campaign.create({
    data: { userId: uiUser.id, query: "Queue UI fixtures", source: "apply" },
  });
  const uiJobs = await Promise.all([
    db.job.create({
      data: {
        campaignId: uiCampaign.campaignId,
        key: "queue-ui-job",
        title: "Queue UI synthetic job",
        company: "Queue Fixture",
        url: "https://queue.example.test/ui/queued",
        status: "approved",
      },
    }),
    db.job.create({
      data: {
        campaignId: uiCampaign.campaignId,
        key: "queue-ui-needs-user",
        title: "Queue UI needs your answer",
        company: "Queue Fixture",
        url: "https://queue.example.test/ui/needs-user",
        status: "needs_user",
      },
    }),
  ]);
  const uiWork = await queue.enqueue(uiUser.id, {
    idempotencyKey: uuid(),
    jobIds: uiJobs.map((job) => job.id),
    source: "user",
    provider: "claude",
  });
  const uiItem = uiWork.items.find((item) => item.jobId === uiJobs[0].id);
  assert.ok(uiItem);
  checks.push(stage);
  assert.equal(externalRequests, 0);
  assert.equal(blockedProcessAttempts, 0);
  report({
    status: "passed",
    checks,
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    automaticAdmission,
    ui: { userId: uiUser.id, workItemId: uiItem.id, jobTitle: uiItem.title },
    evidence: "Synthetic state-transition fixtures only; not application acceptance.",
  });
} catch (error) {
  report({
    status: "failed",
    stage,
    checks,
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    failure: safeTelegramFailure(error),
  });
  process.exitCode = 1;
} finally {
  globalThis.fetch = fetchBefore;
  Bun.spawn = spawnBefore;
  Bun.spawnSync = spawnSyncBefore;
  await db.$disconnect();
}
