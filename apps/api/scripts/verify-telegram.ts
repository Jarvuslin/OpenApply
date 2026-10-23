import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { assertHumanActor } from "../src/common/auth/human-actor";
import { db } from "../src/common/database/prisma.client";
import { container } from "../src/common/di/container";
import {
  countNeedsYou,
  listNeedsYou,
} from "../src/modules/application-question/question.needs-you";
import { assertApplicationAllowed } from "../src/modules/application-rules/application-rules.guard";
import { consumeCheckpointApproval } from "../src/modules/pilot/checkpoint-approval.service";
import { PilotQuestionService } from "../src/modules/pilot/question.service";
import { lockWorkUser } from "../src/modules/work-queue/work-queue.admission";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import { syntheticLoginUpdate } from "./concurrency-regression-guards";
import { uuid } from "./question-regression-fixtures";
import { verifyTelegramIntakes } from "./telegram-intake-regression";
import { verifyTelegramProvenance } from "./telegram-provenance-regression";
import { safeTelegramFailure } from "./telegram-regression-errors";
import {
  approvals,
  attempts,
  checkpointFixture,
  intakes,
  presence,
  rules,
  scoredIntakeFixture,
  syntheticLink,
  telegramFixture,
} from "./telegram-regression-fixtures";
import { verifyTelegramTransport } from "./telegram-transport-regression";

const url = new URL(process.env.DATABASE_URL ?? ""),
  expected = process.env.OPENAPPLY_TELEGRAM_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433" ||
  url.pathname !== `/${expected}`
)
  throw new Error("Telegram regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity";
function report(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  if (process.env.OPENAPPLY_TELEGRAM_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_TELEGRAM_TEST_REPORT, text);
  console.log(text);
}
async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push(name);
}
const queue = new WorkQueueService(db);
async function run() {
  const [identity] = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
  assert.equal(identity?.database, expected);
  assert.equal(identity?.directory, "/var/lib/postgresql/mvp");
  if (process.argv[2] === "ui-login") {
    stage = "synthetic clone login reset";
    const id = process.env.OPENAPPLY_TELEGRAM_TEST_UI_USER,
      email = process.env.OPENAPPLY_TELEGRAM_TEST_LOGIN_EMAIL,
      password = process.env.OPENAPPLY_TELEGRAM_TEST_PASSWORD;
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
  const fetchBefore = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = Object.assign(
    async () => {
      networkAttempts++;
      throw new Error("External network is disabled in Telegram database regression.");
    },
    { preconnect: fetchBefore.preconnect },
  );
  try {
    await check(
      "verified human provenance binds the current owner and link generation",
      async () => {
        const f = await telegramFixture("Actor"),
          link = await syntheticLink(f.user.id),
          actor = { kind: "telegram_user" as const, linkId: link.id, generation: link.generation };
        for (const value of ["agent", "telegram_user", { ...actor, generation: 2 }] as const)
          await assert.rejects(
            db.$transaction(async (tx) => {
              await lockWorkUser(tx, f.user.id);
              await assertHumanActor(tx, f.user.id, value);
            }),
          );
        await assert.rejects(db.$transaction((tx) => assertHumanActor(tx, uuid(), actor)));
        assert.equal(
          await db.$transaction((tx) => assertHumanActor(tx, f.user.id, actor)),
          "telegram_user",
        );
        await db.telegramLink.update({
          where: { id: link.id },
          data: { active: false, senderId: null, chatId: null },
        });
        await assert.rejects(db.$transaction((tx) => assertHumanActor(tx, f.user.id, actor)));
      },
    );
    await check(
      "link intake dedupes canonical replies and preserves all-age submission history without work",
      async () => {
        const f = await telegramFixture("Link intake"),
          base = `https://unfamiliar.example.test/jobs/${uuid()}`;
        const input = { requestId: uuid(), url: `${base}?utm_source=telegram` };
        const a = await intakes.create(f.user.id, input, "session_user"),
          b = await intakes.create(f.user.id, { requestId: uuid(), url: base }, "session_user");
        assert.equal(a.id, b.id);
        assert.equal(a.provider, null);
        assert.equal(a.preparation, "unresolved");
        assert.equal(a.matchScore, null);
        await assert.rejects(
          intakes.decide(
            f.user.id,
            a.id,
            {
              requestId: uuid(),
              expectedRevision: a.revision,
              decision: "queue",
              provider: "claude",
            },
            "session_user",
          ),
        );
        await assert.rejects(
          queue.enqueue(f.user.id, {
            idempotencyKey: uuid(),
            jobIds: [a.jobId!],
            source: "user",
            provider: "claude",
          }),
        );
        const duplicate = await db.job.create({
          data: {
            campaignId: f.campaign.campaignId,
            key: "duplicate",
            url: base,
            title: "Duplicate",
            company: "Synthetic Questions Fixture",
            status: "approved",
          },
        });
        await assert.rejects(
          queue.enqueue(f.user.id, {
            idempotencyKey: uuid(),
            jobIds: [duplicate.id],
            source: "user",
            provider: "claude",
          }),
        );
        const old = `https://history.example.test/jobs/${uuid()}`;
        await db.application.create({
          data: {
            userId: f.user.id,
            url: `${old}?utm_source=old`,
            title: "Old synthetic application",
            company: "Synthetic Questions Fixture",
            source: "manual",
            appliedAt: new Date("2000-01-01"),
          },
        });
        const history = await intakes.create(
          f.user.id,
          { requestId: uuid(), url: old },
          "session_user",
        );
        assert.equal(history.preparation, "already_applied");
        assert.equal(history.jobId, null);
        assert.equal(await db.workItem.count({ where: { userId: f.user.id } }), 0);
      },
    );
    await check(
      "current fit and explicit provider precede a revisioned application decision",
      async () => {
        const f = await scoredIntakeFixture("Decision"),
          id = f.intake.id;
        assert.equal((await intakes.get(f.user.id, id)).matchScore, null);
        await assert.rejects(
          intakes.decide(
            f.user.id,
            id,
            { requestId: uuid(), expectedRevision: 1, decision: "queue", provider: "claude" },
            "session_user",
          ),
        );
        await f.score();
        assert.equal((await intakes.get(f.user.id, id)).preparation, "ready");
        await assert.rejects(
          intakes.decide(
            f.user.id,
            id,
            { requestId: uuid(), expectedRevision: 1, decision: "queue" },
            "session_user",
          ),
        );
        const input = {
          requestId: uuid(),
          expectedRevision: 1,
          decision: "apply_now" as const,
          provider: "claude" as const,
        };
        const a = await intakes.decide(f.user.id, id, input, "session_user"),
          b = await intakes.decide(f.user.id, id, input, "session_user");
        assert.deepEqual(a, b);
        assert.equal(a.provider, "claude");
        assert.ok(a.workItemId);
        assert.ok(
          (await db.workItem.findUniqueOrThrow({ where: { id: a.workItemId } }))
            .priorityRequestedAt,
        );
        await assert.rejects(
          intakes.decide(f.user.id, id, { ...input, decision: "skip" }, "session_user"),
        );
        assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
        await db.user.update({
          where: { id: f.user.id },
          data: { preferredLocations: '["Different location"]' },
        });
        assert.equal((await intakes.get(f.user.id, id)).matchScore, null);
      },
    );
    await check(
      "company exclusions and revision-bound Undo fence duplicate admission and preserve retries",
      async () => {
        const f = await telegramFixture("Rules");
        await db.job.update({ where: { id: f.job.id }, data: { status: "approved" } });
        const input = { requestId: uuid(), expectedRevision: 0, company: f.job.company };
        const excluded = await rules.exclude(f.user.id, input, "session_user");
        assert.equal(excluded.rule.active, true);
        await assert.rejects(
          queue.enqueue(f.user.id, {
            idempotencyKey: uuid(),
            jobIds: [f.job.id],
            source: "user",
            provider: "claude",
          }),
        );
        await assert.rejects(
          db.$transaction((tx) => assertApplicationAllowed(tx, f.user.id, f.job)),
        );
        const undo = { requestId: uuid(), expectedRevision: excluded.revision };
        const reversed = await rules.undo(f.user.id, excluded.id, undo, "session_user");
        assert.equal(reversed.rule.active, false);
        assert.deepEqual(await rules.undo(f.user.id, excluded.id, undo, "session_user"), reversed);
        await assert.rejects(
          rules.undo(f.user.id, excluded.id, { ...undo, requestId: uuid() }, "session_user"),
        );
        await db.job.delete({ where: { id: f.job.id } });
        assert.deepEqual(await rules.exclude(f.user.id, input, "session_user"), excluded);
      },
    );
    await check(
      "checkpoint approvals bind exact evidence, renew expiry, invalidate changes and consume once",
      async () => {
        const f = await checkpointFixture("Approval"),
          id = f.approval.id,
          actor = "session_user" as const;
        const decision = {
          requestId: uuid(),
          checkpointId: f.approval.approvalCheckpointId!,
          checkpointHash: f.approval.approvalCheckpointHash!,
          decision: "approve" as const,
        };
        await assert.rejects(approvals.decide(f.user.id, id, decision, "agent"));
        await assert.rejects(
          approvals.decide(f.user.id, id, { ...decision, checkpointHash: "0".repeat(64) }, actor),
        );
        await assert.rejects(
          container
            .resolve(PilotQuestionService)
            .answerQuestion(f.user.id, id, { answer: "approve" }),
        );
        const approved = await approvals.decide(f.user.id, id, decision, actor);
        assert.equal(approved.approval?.decision, "approve");
        assert.deepEqual(await approvals.decide(f.user.id, id, decision, actor), approved);
        const job = await db.job.findUniqueOrThrow({ where: { id: f.job.id } }),
          attempt = await db.submissionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } });
        await db.$transaction(async (tx) => {
          await lockWorkUser(tx, f.user.id);
          await consumeCheckpointApproval(tx, f.user.id, job, attempt);
        });
        await assert.rejects(
          db.$transaction((tx) => consumeCheckpointApproval(tx, f.user.id, job, attempt)),
        );
        const g = await checkpointFixture("Expiry");
        await db.pilotQuestion.update({
          where: { id: g.approval.id },
          data: { expiresAt: new Date(0) },
        });
        await attempts.checkpoint(g.user.id, g.campaign.campaignId, g.job.key, g.input);
        assert.equal(
          await db.pilotQuestion.count({
            where: { userId: g.user.id, status: "open", expiresAt: { gt: new Date() } },
          }),
          1,
        );
        await db.job.update({
          where: { id: g.job.id },
          data: { description: "Changed synthetic posting" },
        });
        assert.equal(
          await db.pilotQuestion.count({
            where: { userId: g.user.id, status: "open", approvalAttemptId: { not: null } },
          }),
          0,
        );
      },
    );
    await check(
      "linked human answers, saved-answer reuse and PDF selections retain verified provenance",
      () =>
        verifyTelegramProvenance((substep) => {
          stage = substep;
        }),
    );
    await check(
      "runtime presence is server-timed and independent of execution budgets",
      async () => {
        const f = await telegramFixture("Presence"),
          runtimeId = uuid();
        assert.equal((await presence.read(f.user.id)).status, "unknown");
        const input = {
          runtimeId,
          state: "blocked" as const,
          executionAvailable: false,
          blockingCode: "model_approval_required" as const,
        };
        await assert.rejects(presence.heartbeat(f.user.id, input, "session_user"));
        await presence.heartbeat(f.user.id, input, "agent");
        assert.equal((await presence.read(f.user.id)).status, "online");
        assert.equal((await presence.read(f.user.id)).executionAvailable, false);
        await db.runtimePresence.update({
          where: { userId_runtimeId: { userId: f.user.id, runtimeId } },
          data: { lastSeenAt: new Date(0) },
        });
        assert.equal((await presence.read(f.user.id)).status, "unknown");
        assert.equal(await db.workExecution.count({ where: { userId: f.user.id } }), 0);
      },
    );
    stage = "intake regression";
    checks.push(...(await verifyTelegramIntakes()));
    stage = "fake Telegram transport regression";
    const transport = await verifyTelegramTransport(db);
    checks.push(...transport.checks);
    assert.equal(await db.telegramLink.count({ where: { active: true } }), 0);
    assert.equal(
      await db.telegramUpdate.count({ where: { state: { in: ["pending", "processing"] } } }),
      0,
    );
    assert.equal(
      await db.telegramDelivery.count({ where: { state: { in: ["pending", "sending"] } } }),
      0,
    );
    stage = "UI seed";
    const email =
        process.env.OPENAPPLY_TELEGRAM_TEST_LOGIN_EMAIL ?? `${uuid()}@questions.example.test`,
      password = process.env.OPENAPPLY_TELEGRAM_TEST_PASSWORD;
    assert.ok(email.endsWith("@questions.example.test") && password);
    const ui = await checkpointFixture("Telegram approval UI", { email, password }),
      link = await syntheticLink(ui.user.id);
    const intake = await intakes.create(
      ui.user.id,
      { requestId: uuid(), url: `https://unknown-employer.example.test/jobs/${uuid()}` },
      "session_user",
    );
    const target = await listNeedsYou(db, ui.user.id, {
      page: 1,
      limit: 10,
      kind: "all",
      target: ui.approval.id,
    });
    assert.equal(target.items.length, 1);
    assert.equal(target.items[0].id, ui.approval.id);
    assert.ok((await countNeedsYou(db, ui.user.id)).total >= 1);
    assert.equal(networkAttempts, 0);
    assert.equal(await db.workExecution.count(), 0);
    assert.equal(await db.submissionAttempt.count({ where: { startedAt: { not: null } } }), 0);
    checks.push(
      "UI seed retains an exact PDF checkpoint, canonical attention target and unresolved provider-free intake",
    );
    report({
      passed: true,
      mode: "model-free-telegram-regression",
      modelRequests: 0,
      providerProcesses: 0,
      employerSubmissions: 0,
      externalRequests: 0,
      fakeTransportCalls: transport.fakeTransportCalls,
      checks,
      ui: {
        userId: ui.user.id,
        loginEmail: email,
        linkId: link.id,
        approvalQuestionId: ui.approval.id,
        approvalCheckpointId: ui.approval.approvalCheckpointId,
        approvalCheckpointHash: ui.approval.approvalCheckpointHash,
        approvalJobId: ui.job.id,
        approvalCampaignId: ui.campaign.campaignId,
        approvalJobKey: ui.job.key,
        intakeId: intake.id,
        targetSettings: {
          digestEnabled: true,
          digestHour: 18,
          timeZone: "America/Toronto",
          quietHours: null,
        },
      },
    });
  } finally {
    globalThis.fetch = fetchBefore;
  }
}
try {
  await run();
} catch (error) {
  report({
    passed: false,
    mode: "model-free-telegram-regression",
    stage,
    checks,
    error: safeTelegramFailure(error),
    modelRequests: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
  });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
