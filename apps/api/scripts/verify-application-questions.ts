import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "../src/common/database/prisma.client";
import { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import { verifyQuestionConditions } from "./question-regression-conditional";
import {
  answerInput,
  definition,
  fixture,
  observation,
  queue,
} from "./question-regression-fixtures";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_QUESTIONS_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.pathname !== `/${expected}` ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433"
)
  throw new Error("Question regression requires its verified disposable database bridge.");
const service = new ApplicationQuestionService(db);
const checks: string[] = [];
let stage = "database identity";
function report(result: Record<string, unknown>) {
  const text = JSON.stringify(result);
  if (process.env.OPENAPPLY_QUESTIONS_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_QUESTIONS_TEST_REPORT, text);
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
    const id = process.env.OPENAPPLY_QUESTIONS_TEST_UI_USER;
    const email = process.env.OPENAPPLY_QUESTIONS_TEST_LOGIN_EMAIL;
    const password = process.env.OPENAPPLY_QUESTIONS_TEST_PASSWORD;
    assert.ok(id && email?.endsWith("@questions.example.test") && password);
    const user = await db.user.findFirstOrThrow({
      where: { id, email, firstName: "Questions", lastName: "Fixture" },
    });
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await Bun.password.hash(password), emailVerified: true },
    });
    console.log(JSON.stringify({ status: "passed", mode: "clone-only-synthetic-login" }));
    return;
  }
  assert.equal(await db.user.count(), 0);
  checks.push(stage);
  await check("concurrent idempotent observation creates one immutable revision", async () => {
    const f = await fixture("Concurrent observations");
    const input = observation(f);
    await Promise.all([
      service.observe(f.user.id, f.job.id, input, "agent"),
      service.observe(f.user.id, f.job.id, input, "agent"),
    ]);
    assert.equal(await db.jobQuestionCollection.count({ where: { jobId: f.job.id } }), 1);
    assert.equal(await db.applicationQuestion.count({ where: { jobId: f.job.id } }), 1);
    assert.equal((await service.get(f.user.id, f.job.id)).collectionVersion, 1);
    await assert.rejects(
      service.observe(
        f.user.id,
        f.job.id,
        { ...input, definitions: [definition("changed")] },
        "agent",
      ),
    );
    const optimistic = await Promise.allSettled([
      service.observe(f.user.id, f.job.id, observation(f, [definition()], 1), "agent"),
      service.observe(f.user.id, f.job.id, observation(f, [definition()], 1), "agent"),
    ]);
    assert.equal(optimistic.filter((result) => result.status === "fulfilled").length, 1);
  });
  await check("revision changes invalidate current answers but retain history", async () => {
    const f = await fixture("Question revisions");
    await service.observe(f.user.id, f.job.id, observation(f), "agent");
    const first = (await service.get(f.user.id, f.job.id)).questions[0];
    assert.ok(first);
    const answer = answerInput(first);
    await service.answer(f.user.id, first.id, answer, "session_user");
    await service.answer(f.user.id, first.id, answer, "session_user");
    assert.equal(await db.applicationQuestionAnswer.count({ where: { questionId: first.id } }), 1);
    await service.observe(f.user.id, f.job.id, observation(f, [definition()], 1), "agent");
    const identical = (await service.get(f.user.id, f.job.id)).questions[0];
    assert.equal(identical?.id, first.id);
    assert.ok(identical?.answer?.confirmedAt);
    await service.observe(
      f.user.id,
      f.job.id,
      observation(
        f,
        [definition("authorization", "Are you authorized to work in the United States?")],
        2,
      ),
      "agent",
    );
    const changed = (await service.get(f.user.id, f.job.id)).questions.find((q) => q.current);
    assert.equal(changed?.revision, 2);
    assert.equal(changed?.answer, null);
    assert.equal(await db.applicationQuestion.count({ where: { jobId: f.job.id } }), 2);
    await assert.rejects(service.answer(f.user.id, first.id, answerInput(first), "session_user"));
  });
  await check(
    "owned observations and human-only typed answers reject invalid requests",
    async () => {
      const f = await fixture("Owned facts");
      const other = await fixture("Other owner");
      const input = observation(f);
      await assert.rejects(service.observe(other.user.id, f.job.id, input, "agent"));
      await service.observe(f.user.id, f.job.id, input, "agent");
      const q = (await service.get(f.user.id, f.job.id)).questions[0];
      assert.ok(q);
      await assert.rejects(service.get(other.user.id, f.job.id));
      await assert.rejects(service.answer(other.user.id, q.id, answerInput(q), "session_user"));
      await assert.rejects(service.answer(f.user.id, q.id, answerInput(q), "agent"));
      await assert.rejects(
        service.answer(f.user.id, q.id, answerInput(q, "invented-option"), "session_user"),
      );
      await assert.rejects(
        service.answer(
          f.user.id,
          q.id,
          { ...answerInput(q), expectedDefinitionHash: "0".repeat(64) },
          "session_user",
        ),
      );
      assert.equal(await db.applicationQuestionAnswer.count({ where: { questionId: q.id } }), 0);
    },
  );
  await check("partial and blocked collections retain unseen definitions and answers", async () => {
    const f = await fixture("Partial collection");
    await service.observe(
      f.user.id,
      f.job.id,
      observation(f, [
        definition(),
        definition("sponsorship", "Will you require sponsorship in Canada?"),
      ]),
      "agent",
    );
    const q = (await service.get(f.user.id, f.job.id)).questions[0];
    assert.ok(q);
    await service.answer(f.user.id, q.id, answerInput(q), "session_user");
    await service.observe(
      f.user.id,
      f.job.id,
      { ...observation(f, [], 1), coverage: "partial", reason: "Synthetic hidden branch" },
      "agent",
    );
    await service.observe(
      f.user.id,
      f.job.id,
      { ...observation(f, [], 2), coverage: "blocked", reason: "Synthetic unavailable form" },
      "agent",
    );
    const after = await service.get(f.user.id, f.job.id);
    assert.equal(after.questions.filter((item) => item.current).length, 2);
    assert.ok(after.questions.find((item) => item.id === q.id)?.answer?.confirmedAt);
    assert.equal(after.latestCollection?.coverage, "blocked");
  });
  await check("queue resumes only after all confirmed factual blockers resolve", async () => {
    const f = await fixture("All blockers");
    const item = (await f.enqueue()).items[0];
    assert.ok(item);
    await service.observe(
      f.user.id,
      f.job.id,
      observation(f, [
        definition(),
        definition("sponsorship", "Will you need sponsorship in Canada?"),
      ]),
      "agent",
    );
    const questions = (await service.get(f.user.id, f.job.id)).questions;
    assert.equal(questions.length, 2);
    await service.answer(f.user.id, questions[0]!.id, answerInput(questions[0]!), "session_user");
    assert.equal(
      (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
      "needs_user",
    );
    await service.answer(f.user.id, questions[1]!.id, answerInput(questions[1]!), "session_user");
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state, "queued");
  });
  await check(
    "pause stop campaign suspension and ambiguous submissions block answer-driven resume",
    async () => {
      for (const blocker of ["pause", "stop", "campaign", "ambiguous"] as const) {
        const f = await fixture(`Resume guard ${blocker}`);
        const item = (await f.enqueue()).items[0];
        assert.ok(item);
        await service.observe(f.user.id, f.job.id, observation(f), "agent");
        if (blocker === "pause" || blocker === "stop")
          await queue.control(f.user.id, item.id, blocker);
        if (blocker === "campaign")
          await db.campaign.update({
            where: { campaignId: f.campaign.campaignId },
            data: { status: "paused" },
          });
        if (blocker === "ambiguous")
          await db.submissionAttempt.create({
            data: {
              userId: f.user.id,
              jobId: f.job.id,
              originalUrl: f.job.url,
              canonicalUrl: f.job.url,
              startedAt: new Date(),
            },
          });
        const before = (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state;
        const q = (await service.get(f.user.id, f.job.id)).questions[0];
        assert.ok(q);
        await service.answer(f.user.id, q.id, answerInput(q), "session_user");
        assert.equal(
          (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
          before,
        );
      }
    },
  );
  await check("answer arriving before worker handback is reconsidered safely", async () => {
    const f = await fixture("Early answer", { approved: true });
    await f.enqueue();
    const claim = await queue.claim(f.user.id);
    assert.ok(claim);
    await service.observe(f.user.id, f.job.id, observation(f), "agent");
    const q = (await service.get(f.user.id, f.job.id)).questions[0];
    assert.ok(q);
    await service.answer(f.user.id, q.id, answerInput(q), "session_user");
    assert.equal(
      (await db.workItem.findUniqueOrThrow({ where: { id: claim.item.id } })).state,
      "preparing",
    );
    const finished = await queue.finish(f.user.id, claim.item.id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    assert.equal(finished.state, "queued");
  });
  await verifyQuestionConditions(service, check);
  stage = "seed model-free UI questions";
  const loginEmail = process.env.OPENAPPLY_QUESTIONS_TEST_LOGIN_EMAIL;
  const password = process.env.OPENAPPLY_QUESTIONS_TEST_PASSWORD;
  assert.ok(loginEmail?.endsWith("@questions.example.test") && password);
  const f = await fixture("Questions UI synthetic job", { email: loginEmail, password });
  const item = (await f.enqueue()).items[0];
  assert.ok(item);
  const conditional = definition("sponsorshipDetails", "Describe your current work authorization");
  conditional.fields = [{ key: "sponsorshipDetails", type: "text", options: [] }];
  conditional.visibility = "hidden";
  conditional.condition = {
    state: "known",
    rules: [{ fieldKey: "sponsorship", operator: "equals", values: ["no"] }],
  };
  await service.observe(
    f.user.id,
    f.job.id,
    observation(f, [
      definition(),
      definition(
        "sponsorship",
        "Will you now or in the future require employer sponsorship in Canada?",
      ),
      conditional,
    ]),
    "agent",
  );
  const operational = await db.pilotQuestion.create({
    data: {
      userId: f.user.id,
      kind: "approval",
      prompt: "Review the synthetic search plan",
      options: ["Approve", "Skip"],
    },
  });
  const questions = (await service.get(f.user.id, f.job.id)).questions.sort(
    (a, b) =>
      ["authorization", "sponsorship", "sponsorshipDetails"].indexOf(a.definition.stableKey) -
      ["authorization", "sponsorship", "sponsorshipDetails"].indexOf(b.definition.stableKey),
  );
  assert.equal((await service.count(f.user.id)).total, 4);
  const first = await service.list(f.user.id, { page: 1, limit: 2, kind: "all" });
  const second = await service.list(f.user.id, { page: 2, limit: 2, kind: "all" });
  assert.equal(first.pagination.total, 4);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((entry) => entry.id)).size, 4);
  checks.push(stage);
  report({
    status: "passed",
    checks,
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    ui: {
      userId: f.user.id,
      loginEmail,
      workItemId: item.id,
      jobId: f.job.id,
      jobTitle: f.job.title,
      campaignId: f.campaign.campaignId,
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.definition.prompt,
        fieldKey: question.definition.fields[0]!.key,
      })),
      operationalQuestionId: operational.id,
      operationalPrompt: operational.prompt,
      initialCount: 4,
    },
    evidence: "Synthetic question and queue state only; no provider or application execution.",
  });
}

try {
  await run();
} catch (error) {
  report({
    status: "failed",
    stage,
    checks,
    errorClass: error instanceof Error ? error.name : "Error",
    reason:
      error instanceof Error
        ? error.message
            .replaceAll(process.env.OPENAPPLY_QUESTIONS_TEST_PASSWORD ?? "<unset>", "[redacted]")
            .slice(0, 1200)
        : "Unknown regression failure",
    modelCalls: 0,
  });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
