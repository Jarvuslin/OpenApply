import assert from "node:assert/strict";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { db } from "../src/common/database/prisma.client";
import { AnswerBankService } from "../src/modules/answer-bank/answer-bank.service";
import { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import {
  answerInput,
  definition,
  fixture,
  observation,
  uuid,
} from "./question-regression-fixtures";

export const questions = new ApplicationQuestionService(db);
export const bank = new AnswerBankService(db);
export const consent = {
  consent: true as const,
  scope: "account" as const,
  countryCode: "CA",
  countryConfirmed: true as const,
};
export const context = { countryCode: "CA", countryConfirmed: true as const };
export function matchInput(question: ApplicationQuestionView) {
  return {
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    ...context,
  };
}

export async function savedFixture(
  label: string,
  options: { email?: string; password?: string } = {},
) {
  const f = await fixture(label, options);
  await questions.observe(f.user.id, f.job.id, observation(f), "agent");
  const source = (await questions.get(f.user.id, f.job.id)).questions[0];
  assert.ok(source);
  const save = { ...answerInput(source, "yes"), saveToProfile: consent };
  const answer = await questions.answer(f.user.id, source.id, save, "session_user");
  const entries = await bank.list(f.user.id, { page: 1, limit: 10, status: "active" });
  assert.equal(entries.items.length, 1);
  const entry = entries.items[0];
  assert.ok(entry);
  return { ...f, source, save, answer, entry };
}

export async function target(
  f: Awaited<ReturnType<typeof savedFixture>>,
  changes: { prompt?: string; company?: string; title?: string } = {},
) {
  const job = await db.job.create({
    data: {
      campaignId: f.campaign.campaignId,
      key: uuid(),
      title: changes.title ?? f.job.title,
      company: changes.company ?? f.job.company,
      url: `https://jobs.lever.co/questions-fixture/${uuid()}`,
      status: "needs_user",
    },
  });
  const targetDefinition = definition(
    "target-work-right",
    changes.prompt ?? f.source.definition.prompt,
  );
  targetDefinition.fields[0]!.key = "target-work-right";
  targetDefinition.fields[0]!.options = [
    { value: "allowed", label: "Yes" },
    { value: "not_allowed", label: "No" },
  ];
  await questions.observe(
    f.user.id,
    job.id,
    observation({ ...f, job }, [targetDefinition]),
    "agent",
  );
  const question = (await questions.get(f.user.id, job.id)).questions[0];
  assert.ok(question);
  return { job, question };
}
