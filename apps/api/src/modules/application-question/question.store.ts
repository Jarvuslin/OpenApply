import {
  type ApplicationQuestionView,
  applicationQuestionSchema,
  questionAnswerValuesSchema,
  questionDefinitionSchema,
} from "@openapply/contracts/application-question";
import type { Prisma } from "@/generated/prisma/client";
import { resolvedDocumentFields } from "./document.policy";
import { questionBlockers } from "./question.resolution";
import { hasJobQuestionBlockers } from "./question.resume";

export const questionInclude = {
  collection: true,
  answers: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;
type QuestionRow = Prisma.ApplicationQuestionGetPayload<{ include: typeof questionInclude }>;

export function questionView(row: QuestionRow): ApplicationQuestionView {
  const answer = row.answers[0];
  return applicationQuestionSchema.parse({
    ...row,
    definition: questionDefinitionSchema.parse(row.definition),
    source: row.collection.source,
    sourceUrl: row.collection.sourceUrl,
    collectorVersion: row.collection.collectorVersion,
    observedAt: row.collection.observedAt,
    verification: "observed",
    answer: answer
      ? {
          id: answer.id,
          values: questionAnswerValuesSchema.parse(answer.values),
          confirmedAt: answer.confirmedAt,
        }
      : null,
  });
}

export async function recomputeQuestionBlockers(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const rows = await tx.applicationQuestion.findMany({
    where: { userId, jobId, current: true },
    include: questionInclude,
  });
  const blockers = questionBlockers(rows, await resolvedDocumentFields(tx, userId, jobId));
  for (const row of rows) {
    const blocking = blockers.get(row.id) ?? true;
    if (row.blocking !== blocking)
      await tx.applicationQuestion.update({ where: { id: row.id }, data: { blocking } });
  }
  if (await hasJobQuestionBlockers(tx, userId, jobId))
    await tx.workItem.updateMany({
      where: { userId, jobId, state: "queued" },
      data: {
        state: "needs_user",
        reason: "Application questions or form coverage require review.",
      },
    });
}
