import assert from "node:assert/strict";
import type {
  ApplicationQuestionView,
  QuestionDefinition,
  QuestionObservation,
} from "@openapply/contracts/application-question";
import { db } from "../src/common/database/prisma.client";
import { regressionQueue } from "./regression-queue";

export const uuid = () => crypto.randomUUID();
export const queue = regressionQueue(db);

export function definition(
  stableKey = "authorization",
  prompt = "Are you authorized to work in Canada?",
): QuestionDefinition {
  return {
    stableKey,
    prompt,
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields: [
      {
        key: stableKey,
        type: "single_choice",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    ],
  };
}

export async function fixture(
  label: string,
  options: { email?: string; password?: string; approved?: boolean } = {},
) {
  const user = await db.user.create({
    data: {
      queuePolicy: { create: {} },
      email: options.email ?? `${uuid()}@questions.example.test`,
      username: uuid(),
      firstName: "Questions",
      lastName: "Fixture",
      emailVerified: true,
      ...(options.password ? { passwordHash: await Bun.password.hash(options.password) } : {}),
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
      company: "Synthetic Questions Fixture",
      url: `https://jobs.lever.co/questions-fixture/${uuid()}`,
      status: options.approved ? "approved" : "needs_user",
    },
  });
  const enqueue = () =>
    queue.enqueue(user.id, {
      idempotencyKey: uuid(),
      jobIds: [job.id],
      source: "user",
      provider: "claude",
    });
  return { user, campaign, job, enqueue };
}

export function observation(
  f: Awaited<ReturnType<typeof fixture>>,
  definitions = [definition()],
  expectedCollectionVersion = 0,
): QuestionObservation {
  return {
    requestId: uuid(),
    expectedCollectionVersion,
    source: "browser_dom",
    sourceUrl: f.job.url,
    coverage: "complete",
    collectorVersion: "synthetic-regression-v1",
    definitions,
  };
}

export function answerInput(
  question: ApplicationQuestionView,
  value: string | number | boolean | string[] = "yes",
) {
  assert.ok(question.definition.fields[0]);
  return {
    requestId: uuid(),
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    confirmed: true as const,
    values: [{ fieldKey: question.definition.fields[0].key, value }],
  };
}
