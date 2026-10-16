import assert from "node:assert/strict";
import { db } from "../src/common/database/prisma.client";
import { AnswerBankService } from "../src/modules/answer-bank/answer-bank.service";
import { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import { documentFixture, preparation } from "./preparation-regression-fixtures";
import { answerInput, definition, observation, uuid } from "./question-regression-fixtures";
import { syntheticLink, telegramFixture } from "./telegram-regression-fixtures";

export async function verifyTelegramProvenance(stage: (name: string) => void) {
  const questions = new ApplicationQuestionService(db),
    bank = new AnswerBankService(db);
  const f = await telegramFixture("Human answer"),
    link = await syntheticLink(f.user.id);
  const actor = { kind: "telegram_user" as const, linkId: link.id, generation: link.generation };
  stage("human provenance: observe canonical question");
  const observed = await questions.observe(
    f.user.id,
    f.job.id,
    observation(f, [definition()]),
    "agent",
  );
  const question = observed.questions[0];
  assert.ok(question);
  stage("human provenance: confirm and save an answer");
  await questions.answer(
    f.user.id,
    question.id,
    {
      ...answerInput(question),
      saveToProfile: { consent: true, scope: "account", countryCode: "CA", countryConfirmed: true },
    },
    actor,
  );
  const saved = await db.applicationQuestionAnswer.findFirstOrThrow({
    where: { userId: f.user.id, questionId: question.id },
  });
  assert.equal(saved.authorship, "telegram_user");
  assert.equal((await questions.get(f.user.id, f.job.id)).questions[0].blocking, false);
  const job = await db.job.create({
    data: {
      campaignId: f.campaign.campaignId,
      key: uuid(),
      url: `https://jobs.lever.co/questions-fixture/${uuid()}`,
      title: "Canonical answer reuse",
      company: f.job.company,
    },
  });
  const next = (
    await questions.observe(
      f.user.id,
      job.id,
      observation({ ...f, job }, [definition("authorization-next")]),
      "agent",
    )
  ).questions[0];
  assert.ok(next);
  stage("human provenance: reuse only after exact confirmation");
  const matches = await bank.matches(
    f.user.id,
    next.id,
    {
      expectedRevision: next.revision,
      expectedDefinitionHash: next.definitionHash,
      countryCode: "CA",
      countryConfirmed: true,
    },
    actor,
  );
  const match = matches.matches[0];
  assert.ok(match);
  await questions.answer(
    f.user.id,
    next.id,
    {
      ...answerInput(next),
      useSavedAnswer: {
        entryId: match.entryId,
        revision: match.revision,
        countryCode: "CA",
        countryConfirmed: true,
      },
    },
    actor,
  );
  const reused = await db.applicationQuestionAnswer.findFirstOrThrow({
    where: { userId: f.user.id, questionId: next.id },
  });
  assert.equal(reused.authorship, "telegram_user");
  assert.ok(reused.usedBankRevisionId);
  await db.telegramLink.update({
    where: { id: link.id },
    data: { active: false, senderId: null, chatId: null },
  });
  await assert.rejects(questions.answer(f.user.id, next.id, answerInput(next), actor));

  stage("human provenance: select retained PDF and read preparation");
  const document = await documentFixture("Linked human PDF selection");
  await db.telegramSettings.create({ data: { userId: document.user.id } });
  const documentLink = await syntheticLink(document.user.id);
  const documentActor = {
    kind: "telegram_user" as const,
    linkId: documentLink.id,
    generation: documentLink.generation,
  };
  const selection = await preparation.selectDocument(
    document.user.id,
    document.question.id,
    document.input,
    documentActor,
  );
  assert.equal(
    (await db.applicationDocumentSelection.findUniqueOrThrow({ where: { id: selection.id } }))
      .authorship,
    "telegram_user",
  );
  const manifest = await preparation.get(document.user.id, document.job.id);
  assert.equal(manifest.documentFields[0].selection?.available, true);
  assert.equal(manifest.questions[0].blocking, false);
  assert.equal(manifest.submissionAllowed, false);
  await db.telegramLink.update({
    where: { id: documentLink.id },
    data: { active: false, senderId: null, chatId: null },
  });
  await assert.rejects(
    preparation.selectDocument(
      document.user.id,
      document.question.id,
      document.input,
      documentActor,
    ),
  );
}
