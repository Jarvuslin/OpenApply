import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApplicationPreparation,
  PreparationResultInput,
} from "@openapply/contracts/application-preparation";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { db } from "../src/common/database/prisma.client";
import { env } from "../src/env";
import { assertSelectedDocuments } from "../src/modules/application-question/document.store";
import { hasJobQuestionBlockers } from "../src/modules/application-question/question.resume";
import { sha256 } from "../src/modules/resume/resume-artifact-store";
import { lockWorkUser } from "../src/modules/work-queue/work-queue.admission";
import {
  artifacts,
  documentFixture,
  fileDefinition,
  ownedArtifact,
  preparation,
  questions,
} from "./preparation-regression-fixtures";
import { answerInput, definition, observation, queue, uuid } from "./question-regression-fixtures";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_PREPARATION_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.pathname !== `/${expected}` ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433"
)
  throw new Error("Preparation regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity";
function report(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  if (process.env.OPENAPPLY_PREPARATION_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_PREPARATION_TEST_REPORT, text);
  console.log(text);
}
async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push(name);
}
function resultInput(manifest: ApplicationPreparation): PreparationResultInput {
  return {
    requestId: uuid(),
    expectedCollectionVersion: manifest.collectionVersion,
    manifestHash: manifest.manifestHash,
    mode: manifest.mode,
    sourceUrl: manifest.job.url,
    adapterVersion: "real-db-readback-v1",
    status: "filled",
    fields: manifest.questions.flatMap((question) => [
      ...(question.answer?.values.map((value) => ({
        questionId: question.id,
        fieldKey: value.fieldKey,
        status: "verified" as const,
        value: value.value,
      })) ?? []),
      ...manifest.documentFields
        .filter((field) => field.questionId === question.id && field.selection?.available)
        .map((field) => ({
          questionId: question.id,
          fieldKey: field.fieldKey,
          status: "verified" as const,
          pdfSha256: field.selection?.pdfSha256,
        })),
    ]),
  };
}
type Fixture = Awaited<ReturnType<typeof documentFixture>>;
function checkpoint(f: Fixture) {
  return {
    resumeId: f.resume.id,
    resume: { sha256: f.artifact.pdfSha256, artifact: { revision: f.artifact.revision } },
  };
}
async function verifyCheckpoint(f: Fixture, value = checkpoint(f)) {
  return db.$transaction(async (tx) => {
    await lockWorkUser(tx, f.user.id);
    await assertSelectedDocuments(tx, artifacts, f.user.id, f.job.id, value);
  });
}

async function run() {
  const identity = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
  assert.equal(identity[0]?.database, expected);
  assert.equal(identity[0]?.directory, "/var/lib/postgresql/mvp");
  if (process.argv[2] === "ui-login") {
    const id = process.env.OPENAPPLY_PREPARATION_TEST_UI_USER;
    const email = process.env.OPENAPPLY_PREPARATION_TEST_LOGIN_EMAIL;
    const password = process.env.OPENAPPLY_PREPARATION_TEST_PASSWORD;
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
  await check(
    "human document selection is atomic idempotent and resolves the file blocker",
    async () => {
      const f = await documentFixture("Atomic PDF selection");
      const item = (await f.enqueue()).items[0];
      assert.ok(item);
      assert.equal(item.state, "needs_user");
      const selected = await Promise.all([
        preparation.selectDocument(f.user.id, f.question.id, f.input, "session_user"),
        preparation.selectDocument(f.user.id, f.question.id, f.input, "session_user"),
      ]);
      assert.equal(selected[0].id, selected[1].id);
      assert.equal(await db.applicationDocumentSelection.count({ where: { jobId: f.job.id } }), 1);
      assert.equal(
        await db.applicationQuestionAnswer.count({ where: { questionId: f.question.id } }),
        0,
      );
      assert.equal(
        (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
        "queued",
      );
      const manifest = await preparation.get(f.user.id, f.job.id);
      assert.equal(manifest.submissionAllowed, false);
      assert.equal(manifest.questions[0]?.blocking, false);
      assert.equal(manifest.documentFields[0]?.selection?.available, true);
      const bytes = Buffer.from(
        await (await preparation.file(f.user.id, selected[0].id)).arrayBuffer(),
      );
      assert.equal(sha256(bytes), f.artifact.pdfSha256);
      assert.equal(bytes.length, f.artifact.sizeBytes);
      assert.deepEqual(bytes, f.bytes);
      await verifyCheckpoint(f);
    },
  );
  await check(
    "agent foreign stale hash and competing selection requests cannot borrow authority",
    async () => {
      const f = await documentFixture("Selection authority");
      const other = await documentFixture("Foreign document owner");
      await assert.rejects(preparation.selectDocument(f.user.id, f.question.id, f.input, "agent"));
      await assert.rejects(
        preparation.selectDocument(other.user.id, f.question.id, f.input, "session_user"),
      );
      for (const changes of [
        { expectedRevision: 2 },
        { expectedDefinitionHash: "f".repeat(64) },
        { expectedCollectionVersion: 2 },
        { fieldKey: "unknown" },
        { resumeId: other.resume.id },
        { artifactRevision: "f".repeat(64) },
      ])
        await assert.rejects(
          preparation.selectDocument(
            f.user.id,
            f.question.id,
            { ...f.input, ...changes },
            "session_user",
          ),
        );
      assert.equal(await db.applicationDocumentSelection.count({ where: { jobId: f.job.id } }), 0);
      const concurrent = await Promise.allSettled([
        preparation.selectDocument(f.user.id, f.question.id, f.input, "session_user"),
        preparation.selectDocument(
          f.user.id,
          f.question.id,
          { ...f.input, requestId: uuid() },
          "session_user",
        ),
      ]);
      assert.equal(concurrent.filter((value) => value.status === "fulfilled").length, 1);
      const selection = await db.applicationDocumentSelection.findFirstOrThrow({
        where: { jobId: f.job.id },
      });
      await assert.rejects(preparation.file(other.user.id, selection.id));
    },
  );
  await check(
    "file names and unsupported uploads never become factual answers or resume bindings",
    async () => {
      const f = await documentFixture("No filename fact");
      await assert.rejects(
        questions.answer(
          f.user.id,
          f.question.id,
          answerInput(f.question, "resume.pdf"),
          "session_user",
        ),
      );
      for (const prompt of ["Cover letter", "Supporting documents", "Resume and cover letter"]) {
        const unsupported = await documentFixture(`Unsupported ${prompt}`, { prompt });
        await assert.rejects(
          preparation.selectDocument(
            unsupported.user.id,
            unsupported.question.id,
            unsupported.input,
            "session_user",
          ),
        );
        assert.equal(
          (await preparation.get(unsupported.user.id, unsupported.job.id)).documentFields[0]
            ?.purpose,
          "unsupported",
        );
      }
      assert.equal(
        await db.applicationQuestionAnswer.count({ where: { questionId: f.question.id } }),
        0,
      );
    },
  );
  await check(
    "source versions deletion and archived question revisions invalidate live bindings",
    async () => {
      const f = await documentFixture("Stale source metadata");
      const selected = await preparation.selectDocument(
        f.user.id,
        f.question.id,
        f.input,
        "session_user",
      );
      await db.resume.update({ where: { id: f.resume.id }, data: { version: { increment: 1 } } });
      assert.equal(await hasJobQuestionBlockers(db, f.user.id, f.job.id), true);
      await assert.rejects(preparation.file(f.user.id, selected.id));
      await assert.rejects(verifyCheckpoint(f));
      await db.resume.update({ where: { id: f.resume.id }, data: { version: f.resume.version } });
      await questions.observe(
        f.user.id,
        f.job.id,
        observation(f, [fileDefinition("Upload your resume")], 1),
        "agent",
      );
      await assert.rejects(preparation.file(f.user.id, selected.id));
      assert.equal((await questions.get(f.user.id, f.job.id)).questions[0]?.blocking, true);
      const removed = await documentFixture("Deleted document source");
      const binding = await preparation.selectDocument(
        removed.user.id,
        removed.question.id,
        removed.input,
        "session_user",
      );
      await db.resume.delete({ where: { id: removed.resume.id } });
      await assert.rejects(preparation.file(removed.user.id, binding.id));
      assert.equal(await db.applicationDocumentSelection.count({ where: { id: binding.id } }), 1);
    },
  );
  await check(
    "corrupt PDF or original bytes fail download result and checkpoint then restore exactly",
    async () => {
      const f = await documentFixture("Corrupt retained artifact");
      const selected = await preparation.selectDocument(
        f.user.id,
        f.question.id,
        f.input,
        "session_user",
      );
      const input = resultInput(await preparation.get(f.user.id, f.job.id));
      const files = [
        path.resolve(
          env.STORAGE_ROOT,
          "resume-artifacts",
          f.user.id,
          f.resume.id,
          "base",
          f.artifact.revision,
          "resume.pdf",
        ),
        path.resolve(env.STORAGE_ROOT, "resumes", f.resume.sourceFilename!),
      ];
      for (const file of files) {
        const original = await readFile(file);
        try {
          await writeFile(file, Buffer.concat([original, Buffer.from("corrupt-fixture-byte")]));
          await assert.rejects(preparation.file(f.user.id, selected.id));
          await assert.rejects(verifyCheckpoint(f));
          await assert.rejects(
            preparation.result(f.user.id, f.job.id, { ...input, requestId: uuid() }, "agent"),
          );
          assert.equal(
            (await preparation.get(f.user.id, f.job.id)).documentFields[0]?.selection?.available,
            false,
          );
        } finally {
          await writeFile(file, original);
          assert.deepEqual(await readFile(file), original);
        }
      }
      await verifyCheckpoint(f);
      assert.equal(
        (await preparation.get(f.user.id, f.job.id)).documentFields[0]?.selection?.available,
        true,
      );
      await assert.rejects(
        verifyCheckpoint(f, {
          ...checkpoint(f),
          resume: { sha256: "b".repeat(64), artifact: { revision: f.artifact.revision } },
        }),
      );
    },
  );
  await check(
    "replacement preserves immutable selection history and invalidates old downloads",
    async () => {
      const f = await documentFixture("Replace selected PDF");
      const first = await preparation.selectDocument(
        f.user.id,
        f.question.id,
        f.input,
        "session_user",
      );
      const next = await ownedArtifact(f.user.id);
      const replacement = await preparation.selectDocument(
        f.user.id,
        f.question.id,
        {
          ...f.input,
          requestId: uuid(),
          expectedSelectionId: first.id,
          resumeId: next.resume.id,
          artifactRevision: next.artifact.revision,
        },
        "session_user",
      );
      assert.notEqual(first.id, replacement.id);
      assert.equal(await db.applicationDocumentSelection.count({ where: { jobId: f.job.id } }), 2);
      assert.equal(
        (await db.applicationDocumentSelection.findUniqueOrThrow({ where: { id: first.id } }))
          .current,
        false,
      );
      await assert.rejects(preparation.file(f.user.id, first.id));
      assert.equal(
        (await preparation.get(f.user.id, f.job.id)).documentFields[0]?.selection?.id,
        replacement.id,
      );
    },
  );
  await check(
    "mixed all and any groups preserve exact independent text and file requirements",
    async () => {
      for (const groupMode of ["all", "any"] as const) {
        const f = await documentFixture(`Mixed ${groupMode} form`);
        const mixed: QuestionDefinition = fileDefinition();
        mixed.groupMode = groupMode;
        mixed.fields.push({ key: "note", label: "Explanation", type: "text", options: [] });
        await questions.observe(f.user.id, f.job.id, observation(f, [mixed], 1), "agent");
        const q = (await questions.get(f.user.id, f.job.id)).questions[0];
        assert.ok(q);
        const item = (await f.enqueue()).items[0];
        assert.ok(item);
        if (groupMode === "all") {
          await preparation.selectDocument(
            f.user.id,
            q.id,
            {
              ...f.input,
              expectedCollectionVersion: 2,
              expectedRevision: q.revision,
              expectedDefinitionHash: q.definitionHash,
            },
            "session_user",
          );
          assert.equal(
            (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
            "needs_user",
          );
        }
        await questions.answer(
          f.user.id,
          q.id,
          {
            ...answerInput(q),
            values: [{ fieldKey: "note", value: "Confirmed applicant explanation" }],
          },
          "session_user",
        );
        assert.equal(
          (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
          "queued",
        );
      }
    },
  );
  await check("required unknown coverage remains parked after a valid PDF selection", async () => {
    const f = await documentFixture("Unknown form coverage");
    const item = (await f.enqueue()).items[0];
    assert.ok(item);
    await questions.observe(
      f.user.id,
      f.job.id,
      {
        ...observation(f, [fileDefinition()], 1),
        coverage: "partial",
        reason: "Dynamic page remains unobserved",
      },
      "agent",
    );
    await preparation.selectDocument(
      f.user.id,
      f.question.id,
      { ...f.input, expectedCollectionVersion: 2 },
      "session_user",
    );
    assert.equal(
      (await db.workItem.findUniqueOrThrow({ where: { id: item.id } })).state,
      "needs_user",
    );
    const input = resultInput(await preparation.get(f.user.id, f.job.id));
    await assert.rejects(preparation.result(f.user.id, f.job.id, input, "agent"));
    await preparation.result(f.user.id, f.job.id, { ...input, status: "partial" }, "agent");
    assert.equal((await questions.get(f.user.id, f.job.id)).latestCollection?.coverage, "partial");
  });
  await check(
    "readback requires every required group and exact fields without overwriting old evidence",
    async () => {
      const f = await documentFixture("Exact readback");
      const text = definition("confirmation", "Applicant confirmation");
      text.fields = [{ key: "confirmation", label: "Confirmation", type: "text", options: [] }];
      await questions.observe(
        f.user.id,
        f.job.id,
        observation(f, [fileDefinition(), text], 1),
        "agent",
      );
      const snapshot = await questions.get(f.user.id, f.job.id);
      const q = snapshot.questions.find((row) => row.definition.stableKey === "confirmation");
      assert.ok(q);
      await preparation.selectDocument(
        f.user.id,
        f.question.id,
        { ...f.input, expectedCollectionVersion: 2 },
        "session_user",
      );
      await questions.answer(f.user.id, q.id, answerInput(q, "Confirmed text"), "session_user");
      const input = resultInput(await preparation.get(f.user.id, f.job.id));
      for (const fields of [
        [],
        input.fields.slice(0, 1),
        [...input.fields, input.fields[0]!],
        input.fields.map((field) => ({ ...field, fieldKey: "not-owned" })),
        input.fields.map((field) =>
          field.value !== undefined ? { ...field, value: "Changed" } : field,
        ),
        input.fields.map((field) =>
          field.pdfSha256 ? { ...field, pdfSha256: "a".repeat(64) } : field,
        ),
      ])
        await assert.rejects(
          preparation.result(f.user.id, f.job.id, { ...input, requestId: uuid(), fields }, "agent"),
        );
      const saved = await preparation.result(f.user.id, f.job.id, input, "agent");
      assert.equal(saved.verification, "observed");
      assert.equal(saved.submissionAllowed, false);
      assert.equal((await preparation.result(f.user.id, f.job.id, input, "agent")).id, saved.id);
      const before = await db.applicationPreparationResult.findUniqueOrThrow({
        where: { id: saved.id },
      });
      await questions.answer(
        f.user.id,
        q.id,
        answerInput(q, "New human confirmation"),
        "session_user",
      );
      await assert.rejects(
        preparation.result(f.user.id, f.job.id, { ...input, requestId: uuid() }, "agent"),
      );
      assert.deepEqual(
        await db.applicationPreparationResult.findUniqueOrThrow({ where: { id: saved.id } }),
        before,
      );
    },
  );
  await check(
    "worker mode needs an exact lease while preview rejects ambiguous or submitted replay",
    async () => {
      const f = await documentFixture("Worker lease fence");
      await preparation.selectDocument(f.user.id, f.question.id, f.input, "session_user");
      await assert.rejects(preparation.get(f.user.id, f.job.id, { mode: "worker" }));
      const input = resultInput(await preparation.get(f.user.id, f.job.id));
      await assert.rejects(
        preparation.result(
          f.user.id,
          f.job.id,
          { ...input, mode: "worker" },
          "agent",
          uuid(),
          uuid(),
        ),
      );
      await db.submissionAttempt.create({
        data: {
          userId: f.user.id,
          jobId: f.job.id,
          originalUrl: f.job.url,
          canonicalUrl: f.job.url,
          startedAt: new Date(),
        },
      });
      await assert.rejects(preparation.get(f.user.id, f.job.id));
      await assert.rejects(preparation.result(f.user.id, f.job.id, input, "agent"));
      const closed = await documentFixture("Already applied preview");
      await db.job.update({ where: { id: closed.job.id }, data: { status: "applied" } });
      await assert.rejects(preparation.get(closed.user.id, closed.job.id));
    },
  );
  stage = "seed model-free document preparation UI";
  const loginEmail = process.env.OPENAPPLY_PREPARATION_TEST_LOGIN_EMAIL;
  const password = process.env.OPENAPPLY_PREPARATION_TEST_PASSWORD;
  assert.ok(loginEmail?.endsWith("@questions.example.test") && password);
  const fixtureUrl = "http://127.0.0.1:14640/form";
  const f = await documentFixture("Prepare selected resume", {
    email: loginEmail,
    password,
    url: fixtureUrl,
  });
  const email = definition("fields:email", "Email");
  email.fields = [{ key: "email", label: "Email", type: "email", options: [] }];
  await questions.observe(
    f.user.id,
    f.job.id,
    observation(f, [fileDefinition(), email], 1),
    "agent",
  );
  const snapshot = await questions.get(f.user.id, f.job.id);
  const emailQuestion = snapshot.questions.find(
    (question) => question.definition.stableKey === email.stableKey,
  );
  assert.ok(emailQuestion);
  await questions.answer(
    f.user.id,
    emailQuestion.id,
    answerInput(emailQuestion, "documents@questions.example.test"),
    "session_user",
  );
  const item = (
    await queue.enqueue(f.user.id, {
      idempotencyKey: uuid(),
      jobIds: [f.job.id],
      source: "user",
      provider: "claude",
    })
  ).items[0];
  assert.ok(item);
  assert.equal(item.state, "needs_user");
  assert.equal((await questions.count(f.user.id)).total, 1);
  assert.equal(await db.applicationDocumentSelection.count({ where: { jobId: f.job.id } }), 0);
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
      jobId: f.job.id,
      campaignId: f.campaign.campaignId,
      workItemId: item.id,
      questionId: f.question.id,
      fileFieldKey: "resume",
      resumeId: f.resume.id,
      artifactRevision: f.artifact.revision,
      pdfSha256: f.artifact.pdfSha256,
      initialCount: 1,
      jobTitle: f.job.title,
      fixtureUrl,
    },
    evidence:
      "Synthetic human-selected canonical PDFs and observed model-free preparation only; compilation is not factual review or application acceptance.",
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
            .replaceAll(process.env.OPENAPPLY_PREPARATION_TEST_PASSWORD ?? "<unset>", "[redacted]")
            .slice(0, 1200)
        : "Unknown regression failure",
    modelCalls: 0,
  });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
