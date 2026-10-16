import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "../src/common/database/prisma.client";
import {
  bank,
  consent,
  context,
  matchInput,
  questions,
  savedFixture,
  target,
} from "./answer-bank-regression-fixtures";
import {
  answerInput,
  definition,
  fixture,
  observation,
  queue,
  uuid,
} from "./question-regression-fixtures";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_BANK_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.pathname !== `/${expected}` ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433"
)
  throw new Error("Answer bank regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity";
const report = (result: Record<string, unknown>) => {
  const text = JSON.stringify(result);
  if (process.env.OPENAPPLY_BANK_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_BANK_TEST_REPORT, text);
  console.log(text);
};
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
    const id = process.env.OPENAPPLY_BANK_TEST_UI_USER;
    const email = process.env.OPENAPPLY_BANK_TEST_LOGIN_EMAIL;
    const password = process.env.OPENAPPLY_BANK_TEST_PASSWORD;
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
  await check("answer and save consent are atomic and idempotent", async () => {
    const f = await savedFixture("Atomic bank save");
    await questions.answer(f.user.id, f.source.id, f.save, "session_user");
    assert.equal(
      await db.applicationQuestionAnswer.count({ where: { questionId: f.source.id } }),
      1,
    );
    assert.equal(await db.answerBankEntry.count({ where: { userId: f.user.id } }), 1);
    assert.equal(await db.answerBankRevision.count({ where: { userId: f.user.id } }), 1);
    assert.ok(f.entry.available, f.entry.unavailableReason ?? "Fresh confirmed entry unavailable");
    assert.equal(f.entry.sourceAnswerId, f.answer.answer?.id);
    assert.equal(f.entry.requiresConfirmation, true);
    await assert.rejects(
      questions.answer(
        f.user.id,
        f.source.id,
        { ...f.save, saveToProfile: { ...consent, countryCode: "US" } },
        "session_user",
      ),
    );
    const invalid = await fixture("Atomic rejected consent");
    await questions.observe(invalid.user.id, invalid.job.id, observation(invalid), "agent");
    const q = (await questions.get(invalid.user.id, invalid.job.id)).questions[0];
    assert.ok(q);
    await assert.rejects(
      questions.answer(
        invalid.user.id,
        q.id,
        { ...answerInput(q), saveToProfile: { consent: true, scope: "account" } },
        "session_user",
      ),
    );
    assert.equal(await db.applicationQuestionAnswer.count({ where: { questionId: q.id } }), 0);
    assert.equal(await db.answerBankEntry.count({ where: { userId: invalid.user.id } }), 0);
  });
  await check("matches remap exact choice labels without answering automatically", async () => {
    const f = await savedFixture("Exact target mapping");
    const t = await target(f);
    const matches = await bank.matches(
      f.user.id,
      t.question.id,
      matchInput(t.question),
      "session_user",
    );
    assert.equal(matches.status, "matched");
    assert.equal(matches.matches.length, 1);
    assert.deepEqual(matches.matches[0]?.mappedValues, [
      { fieldKey: "target-work-right", value: "allowed" },
    ]);
    assert.equal(
      await db.applicationQuestionAnswer.count({ where: { questionId: t.question.id } }),
      0,
    );
    const input = {
      ...answerInput(t.question, "allowed"),
      useSavedAnswer: { entryId: f.entry.id, revision: f.entry.revision, ...context },
    };
    await assert.rejects(questions.answer(f.user.id, t.question.id, input, "agent"));
    await questions.answer(f.user.id, t.question.id, input, "session_user");
    const saved = await db.applicationQuestionAnswer.findFirstOrThrow({
      where: { questionId: t.question.id },
    });
    assert.ok(saved.usedBankRevisionId);
    assert.equal(saved.authorship, "session_user");
    assert.ok(saved.confirmedAt);
  });
  await check("sensitive country and opposite wording never silently match", async () => {
    const f = await savedFixture("Country and meaning");
    const t = await target(f);
    for (const countryCode of [undefined, "US", "ZZ"]) {
      const result = await bank.matches(
        f.user.id,
        t.question.id,
        { ...matchInput(t.question), countryCode },
        "session_user",
      );
      assert.equal(result.matches.length, 0);
    }
    const opposite = await target(f, { prompt: "Are you NOT authorized to work in Canada?" });
    const sponsor = await target(f, {
      prompt: "Will you now or in the future require sponsorship to work in Canada?",
    });
    for (const q of [opposite.question, sponsor.question])
      assert.equal(
        (await bank.matches(f.user.id, q.id, matchInput(q), "session_user")).matches.length,
        0,
      );
  });
  await check("cross-account and agent attempts cannot borrow confirmation authority", async () => {
    const f = await savedFixture("Bank ownership");
    const other = await savedFixture("Other bank owner");
    const t = await target(f);
    await assert.rejects(bank.detail(other.user.id, f.entry.id, { page: 1, limit: 10 }));
    await assert.rejects(
      bank.matches(other.user.id, t.question.id, matchInput(t.question), "session_user"),
    );
    await assert.rejects(
      bank.revoke(f.user.id, f.entry.id, { requestId: uuid(), expectedRevision: 1 }, "agent"),
    );
    await assert.rejects(
      questions.answer(
        f.user.id,
        t.question.id,
        {
          ...answerInput(t.question, "allowed"),
          useSavedAnswer: { entryId: other.entry.id, revision: other.entry.revision, ...context },
        },
        "session_user",
      ),
    );
    assert.equal(
      await db.applicationQuestionAnswer.count({ where: { questionId: t.question.id } }),
      0,
    );
  });
  await check("revoked saved matches reject stale use without persisting an answer", async () => {
    const f = await savedFixture("Revoke race");
    const t = await target(f);
    assert.equal(
      (await bank.matches(f.user.id, t.question.id, matchInput(t.question), "session_user")).status,
      "matched",
    );
    const revoke = { requestId: uuid(), expectedRevision: f.entry.revision };
    await bank.revoke(f.user.id, f.entry.id, revoke, "session_user");
    await bank.revoke(f.user.id, f.entry.id, revoke, "session_user");
    assert.equal(await db.answerBankRevision.count({ where: { entryId: f.entry.id } }), 2);
    assert.equal(
      (await bank.matches(f.user.id, t.question.id, matchInput(t.question), "session_user")).matches
        .length,
      0,
    );
    await assert.rejects(
      questions.answer(
        f.user.id,
        t.question.id,
        {
          ...answerInput(t.question, "allowed"),
          useSavedAnswer: { entryId: f.entry.id, revision: 1, ...context },
        },
        "session_user",
      ),
    );
    assert.equal(
      await db.applicationQuestionAnswer.count({ where: { questionId: t.question.id } }),
      0,
    );
    const history = await bank.detail(f.user.id, f.entry.id, { page: 1, limit: 10 });
    assert.equal(history.entry.action, "revoke");
  });
  await check(
    "superseded source answers are unavailable until explicitly saved again",
    async () => {
      const f = await savedFixture("Source correction");
      const t = await target(f);
      const corrected = await questions.answer(
        f.user.id,
        f.source.id,
        answerInput(f.source, "no"),
        "session_user",
      );
      assert.equal(
        (await bank.matches(f.user.id, t.question.id, matchInput(t.question), "session_user"))
          .matches.length,
        0,
      );
      assert.ok(corrected.answer);
      await bank.revise(
        f.user.id,
        f.entry.id,
        {
          requestId: uuid(),
          expectedRevision: 1,
          sourceAnswerId: corrected.answer.id,
          consent: true,
          countryConfirmed: true,
        },
        "session_user",
      );
      const current = await bank.matches(
        f.user.id,
        t.question.id,
        matchInput(t.question),
        "session_user",
      );
      assert.equal(current.status, "matched");
      assert.equal(current.matches[0]?.revision, 2);
      assert.deepEqual(current.matches[0]?.mappedValues, [
        { fieldKey: "target-work-right", value: "not_allowed" },
      ]);
      await assert.rejects(
        questions.answer(
          f.user.id,
          t.question.id,
          {
            ...answerInput(t.question, "allowed"),
            useSavedAnswer: { entryId: f.entry.id, revision: 1, ...context },
          },
          "session_user",
        ),
      );
    },
  );
  await check("same-timestamp conflicting human facts fail closed", async () => {
    const f = await savedFixture("Ambiguous source chronology");
    const t = await target(f);
    await questions.answer(f.user.id, f.source.id, answerInput(f.source, "no"), "session_user");
    const time = new Date("2026-10-08T12:00:00.000Z");
    await db.applicationQuestionAnswer.updateMany({
      where: { questionId: f.source.id },
      data: { createdAt: time, confirmedAt: time },
    });
    assert.equal(
      (await bank.matches(f.user.id, t.question.id, matchInput(t.question), "session_user")).matches
        .length,
      0,
    );
  });
  await check(
    "identical human reconfirmation preserves the factual checkpoint timestamp",
    async () => {
      const f = await savedFixture("Unchanged factual answer");
      const before = await db.job.findUniqueOrThrow({ where: { id: f.job.id } });
      await questions.answer(f.user.id, f.source.id, answerInput(f.source), "session_user");
      const after = await db.job.findUniqueOrThrow({ where: { id: f.job.id } });
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    },
  );
  await check("deleted source evidence stays historical and cannot be reused", async () => {
    const f = await savedFixture("Deleted source provenance");
    await db.campaign.delete({ where: { campaignId: f.campaign.campaignId } });
    const history = await bank.detail(f.user.id, f.entry.id, { page: 1, limit: 10 });
    assert.equal(history.entry.available, false);
    assert.equal(history.entry.sourceAnswerId, null);
    assert.equal(history.entry.sourceQuestionId, f.source.id);
    assert.deepEqual(history.entry.sourceValues, f.answer.answer?.values);
  });
  await check("profile defaults never populate the saved-answer bank", async () => {
    const f = await fixture("Unconfirmed profile defaults");
    await questions.observe(f.user.id, f.job.id, observation(f, [definition()]), "agent");
    assert.equal(
      (await bank.list(f.user.id, { page: 1, limit: 10, status: "all" })).pagination.total,
      0,
    );
    const q = (await questions.get(f.user.id, f.job.id)).questions[0];
    assert.ok(q);
    assert.equal(
      (await bank.matches(f.user.id, q.id, matchInput(q), "session_user")).matches.length,
      0,
    );
  });
  stage = "seed model-free saved-answer UI";
  const loginEmail = process.env.OPENAPPLY_BANK_TEST_LOGIN_EMAIL;
  const password = process.env.OPENAPPLY_BANK_TEST_PASSWORD;
  assert.ok(loginEmail?.endsWith("@questions.example.test") && password);
  const f = await savedFixture("Saved answer source job", { email: loginEmail, password });
  const t = await target(f, { title: "Saved answer target job" });
  const contactJob = await db.job.create({
    data: {
      campaignId: f.campaign.campaignId,
      key: uuid(),
      title: "Save contact answer job",
      company: f.job.company,
      url: `https://jobs.lever.co/questions-fixture/${uuid()}`,
      status: "needs_user",
    },
  });
  const contact = definition("contact_email", "What email should we use for this application?");
  contact.fields = [{ key: "contact_email", type: "email", options: [] }];
  await questions.observe(
    f.user.id,
    contactJob.id,
    observation({ ...f, job: contactJob }, [contact]),
    "agent",
  );
  const contactQuestion = (await questions.get(f.user.id, contactJob.id)).questions[0];
  assert.ok(contactQuestion);
  const item = (
    await queue.enqueue(f.user.id, {
      idempotencyKey: uuid(),
      jobIds: [t.job.id],
      source: "user",
      provider: "claude",
    })
  ).items[0];
  assert.ok(item);
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
      jobId: t.job.id,
      jobTitle: t.job.title,
      campaignId: f.campaign.campaignId,
      questionId: t.question.id,
      questionPrompt: t.question.definition.prompt,
      fieldKey: t.question.definition.fields[0]!.key,
      entryId: f.entry.id,
      entryRevision: f.entry.revision,
      sourceJobId: f.job.id,
      sourceQuestionId: f.source.id,
      sourceAnswerId: f.answer.answer!.id,
      countryCode: "CA",
      mappedValue: "allowed",
      initialCount: 2,
      saveJobId: contactJob.id,
      saveQuestionId: contactQuestion.id,
      saveQuestionPrompt: contact.prompt,
      saveFieldKey: "contact_email",
      saveValue: "bank.fixture@questions.example.test",
    },
    evidence:
      "Synthetic saved human answers and deterministic matching only; no application execution.",
  });
}
try {
  await run();
} catch (error) {
  report({
    status: "failed",
    stage,
    checks,
    reason:
      error instanceof Error
        ? error.message
            .replaceAll(process.env.OPENAPPLY_BANK_TEST_PASSWORD ?? "<unset>", "[redacted]")
            .slice(0, 1200)
        : "Unknown regression failure",
    modelCalls: 0,
  });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
