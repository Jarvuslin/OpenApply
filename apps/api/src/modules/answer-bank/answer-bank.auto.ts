import type { QuestionCategory } from "@openapply/contracts/answer-bank";
import { BANK_COUNTRY_REQUIRED_CATEGORIES } from "@openapply/contracts/answer-bank-input";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import type { Prisma } from "@/generated/prisma/client";
import { questionHash } from "@/modules/application-question/question.policy";
import { findBankMatches } from "./answer-bank.matches";

/**
 * Answer a newly collected question from the one saved answer that maps onto it exactly.
 * The person confirmed the source answer and chose automatic reuse, so it counts as theirs.
 */
export async function autoAnswerFromBank(
  tx: Prisma.TransactionClient,
  userId: string,
  question: {
    id: string;
    jobId: string;
    definition: QuestionDefinition;
    category: QuestionCategory;
  },
) {
  // A country-bound answer needs the job's country confirmed, which collection does not know.
  if (BANK_COUNTRY_REQUIRED_CATEGORIES.some((category) => category === question.category)) return;
  const job = await tx.job.findUnique({
    where: { id: question.jobId },
    select: { company: true, title: true },
  });
  if (!job) return;
  const matches = await findBankMatches(tx, userId, {
    definition: question.definition,
    category: question.category,
    countryCode: null,
    countryConfirmed: false,
    company: job.company,
    jobTitle: job.title,
  });
  if (matches?.length !== 1) return;
  const [match] = matches;
  await tx.applicationQuestionAnswer.create({
    data: {
      questionId: question.id,
      userId,
      requestId: crypto.randomUUID(),
      payloadHash: questionHash({ id: question.id, bankRevisionId: match.bankRevisionId }),
      values: match.mappedValues,
      authorship: "session_user",
      confirmedAt: new Date(),
      usedBankRevisionId: match.bankRevisionId,
      reuseContext: {
        entryId: match.entryId,
        revision: match.revision,
        countryCode: null,
        countryConfirmed: false,
        automatic: true,
      },
    },
  });
}
