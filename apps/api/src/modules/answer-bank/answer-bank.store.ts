import { type BankEntry, bankEntrySchema } from "@openapply/contracts/answer-bank";
import type { SaveToProfile, UseSavedAnswer } from "@openapply/contracts/answer-bank-input";
import {
  type QuestionDefinition,
  questionAnswerValuesSchema,
  questionDefinitionSchema,
} from "@openapply/contracts/application-question";
import { z } from "zod/v4";
import { isHumanAuthorship } from "@/common/auth/human-actor";
import { badRequest, conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import type { Prisma, QuestionCategory } from "@/generated/prisma/client";
import { questionHash } from "@/modules/application-question/question.policy";
import { sameAnswerValues } from "@/modules/application-question/question.values";
import { BANK_NORMALIZER_VERSION, bankEligibility, mapBankAnswer } from "./answer-bank.policy";

const sourceInclude = {
  question: {
    include: { job: true, answers: { orderBy: { createdAt: "desc" as const }, take: 2 } },
  },
} as const;
export const bankRevisionInclude = {
  entry: true,
  sourceAnswer: { include: sourceInclude },
} as const;
export type BankRevisionRow = Prisma.AnswerBankRevisionGetPayload<{
  include: typeof bankRevisionInclude;
}>;
const snapshotSchema = z.object({
  questionId: z.uuid(),
  jobId: z.uuid(),
  questionRevision: z.number().int(),
  definitionHash: z.string(),
  definition: questionDefinitionSchema,
  values: questionAnswerValuesSchema,
  confirmedAt: z.iso.datetime(),
});

export function bankAvailability(row: BankRevisionRow): string | null {
  if (row.entry.userId !== row.userId) return "Saved answer ownership does not match.";
  if (row.action === "revoke" || !row.entry.active) return "This saved answer was revoked.";
  if (row.revision !== row.entry.currentRevision) return "This saved revision has been replaced.";
  if (row.normalizerVersion !== BANK_NORMALIZER_VERSION)
    return "This saved answer requires renewed matching consent.";
  const source = row.sourceAnswer;
  if (
    !source ||
    source.userId !== row.userId ||
    source.question.userId !== row.userId ||
    !source.confirmedAt ||
    !isHumanAuthorship(source.authorship)
  )
    return "The original human-confirmed answer is no longer available.";
  if (
    source.question.answers[0]?.createdAt.getTime() ===
    source.question.answers[1]?.createdAt.getTime()
  )
    return "The latest source answers have ambiguous ordering. Confirm and save a fresh answer.";
  if (!source.question.current || source.question.answers[0]?.id !== source.id)
    return "The source question or its confirmed answer has changed. Save a current answer again.";
  const snapshot = snapshotSchema.parse(row.sourceSnapshot);
  if (
    snapshot.questionId !== source.questionId ||
    snapshot.jobId !== source.question.jobId ||
    snapshot.questionRevision !== source.question.revision ||
    snapshot.confirmedAt !== source.confirmedAt.toISOString() ||
    row.category !== source.question.category ||
    snapshot.definitionHash !== source.question.definitionHash ||
    !sameAnswerValues(snapshot.values, source.values)
  )
    return "The saved source evidence changed.";
  const eligibility = bankEligibility(
    snapshot.definition,
    row.category,
    {
      countryCode: row.countryCode,
      countryConfirmed: row.countryCode !== null,
      company: source.question.job.company,
      jobTitle: source.question.job.title,
    },
    row.scope,
  );
  if (
    !eligibility.eligible ||
    eligibility.fingerprint !== row.fingerprint ||
    eligibility.employerKey !== row.employerKey ||
    eligibility.roleKey !== row.roleKey
  )
    return "The source employer, role or saved matching context changed. Confirm and save again.";
  return null;
}

export function bankView(row: BankRevisionRow): BankEntry {
  const snapshot = snapshotSchema.parse(row.sourceSnapshot);
  const unavailableReason = bankAvailability(row);
  return bankEntrySchema.parse({
    id: row.entryId,
    revisionId: row.id,
    revision: row.revision,
    action: row.action,
    available: unavailableReason === null,
    unavailableReason,
    scope: row.scope,
    category: row.category,
    countryCode: row.countryCode,
    employerKey: row.employerKey,
    roleKey: row.roleKey,
    sourceAnswerId: row.sourceAnswerId,
    sourceQuestionId: snapshot.questionId,
    sourceJobId: snapshot.jobId,
    sourceDefinition: snapshot.definition,
    sourceValues: snapshot.values,
    sourceConfirmedAt: new Date(snapshot.confirmedAt),
    consentedAt: row.consentedAt,
    createdAt: row.createdAt,
    requiresConfirmation: true,
  });
}

export async function saveConfirmedAnswer(
  tx: Prisma.TransactionClient,
  userId: string,
  sourceAnswerId: string,
  input: SaveToProfile,
  requestId: string,
) {
  const payloadHash = questionHash({ sourceAnswerId, input });
  const previous = await tx.answerBankRevision.findUnique({
    where: { userId_requestId: { userId, requestId } },
    include: bankRevisionInclude,
  });
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      throw conflict("Saved-answer request ID was reused with different content.");
    return previous;
  }
  const answer = await tx.applicationQuestionAnswer.findFirst({
    where: { id: sourceAnswerId, userId },
    include: sourceInclude,
  });
  if (!answer) throw notFound("Confirmed source answer not found");
  const question = answer.question;
  if (question.answers[0]?.createdAt.getTime() === question.answers[1]?.createdAt.getTime())
    throw conflict(
      "The latest source answers have ambiguous ordering. Confirm and save a fresh answer.",
    );
  if (
    !isHumanAuthorship(answer.authorship) ||
    !answer.confirmedAt ||
    !question.current ||
    question.userId !== userId ||
    question.answers[0]?.id !== answer.id
  )
    throw conflict("Only the latest human-confirmed answer to a current question can be saved.");
  const definition = questionDefinitionSchema.parse(question.definition);
  const eligibility = bankEligibility(
    definition,
    question.category,
    {
      countryCode: input.countryCode ?? null,
      countryConfirmed: input.countryConfirmed === true,
      company: question.job.company,
      jobTitle: question.job.title,
    },
    input.scope,
  );
  if (!eligibility.eligible || !eligibility.fingerprint)
    throw badRequest(eligibility.reason ?? "This answer cannot be reused safely.");
  const countryCode = input.countryCode ?? null;
  const identityHash = questionHash({
    fingerprint: eligibility.fingerprint,
    countryCode,
    scope: input.scope,
    employerKey: eligibility.employerKey,
    roleKey: eligibility.roleKey,
  });
  let entry = await tx.answerBankEntry.findUnique({
    where: { userId_identityHash: { userId, identityHash } },
  });
  if (
    input.expectedBank &&
    (!entry ||
      entry.id !== input.expectedBank.entryId ||
      entry.currentRevision !== input.expectedBank.revision)
  )
    throw conflict("The saved answer changed. Review its current revision before replacing it.");
  if (entry && !input.expectedBank)
    throw conflict(
      "A saved answer already exists for this question and scope. Review and explicitly replace its current revision.",
    );
  if (!entry)
    entry = await tx.answerBankEntry.create({
      data: { userId, identityHash, currentRevision: 1, active: true },
    });
  else
    entry = await tx.answerBankEntry.update({
      where: { id: entry.id },
      data: { currentRevision: entry.currentRevision + 1, active: true },
    });
  return tx.answerBankRevision.create({
    data: {
      userId,
      entryId: entry.id,
      revision: entry.currentRevision,
      action: "save",
      requestId,
      payloadHash,
      sourceAnswerId: answer.id,
      sourceSnapshot: toInputJson({
        questionId: question.id,
        jobId: question.jobId,
        questionRevision: question.revision,
        definitionHash: question.definitionHash,
        definition,
        values: answer.values,
        confirmedAt: answer.confirmedAt,
      }),
      fingerprint: eligibility.fingerprint,
      normalizerVersion: BANK_NORMALIZER_VERSION,
      scope: input.scope,
      category: question.category,
      countryCode,
      employerKey: eligibility.employerKey,
      roleKey: eligibility.roleKey,
      consentedAt: new Date(),
    },
    include: bankRevisionInclude,
  });
}

export async function validateSavedAnswer(
  tx: Prisma.TransactionClient,
  userId: string,
  question: {
    definition: QuestionDefinition;
    category: QuestionCategory;
    company: string;
    jobTitle: string;
  },
  input: UseSavedAnswer,
  values: z.infer<typeof questionAnswerValuesSchema>,
) {
  const row = await tx.answerBankRevision.findFirst({
    where: { userId, entryId: input.entryId, revision: input.revision },
    include: bankRevisionInclude,
  });
  if (!row) throw notFound("Saved answer not found");
  const unavailable = bankAvailability(row);
  if (unavailable) throw conflict(unavailable);
  const snapshot = snapshotSchema.parse(row.sourceSnapshot);
  const result = mapBankAnswer(
    {
      definition: snapshot.definition,
      category: row.category,
      values: snapshot.values,
      countryCode: row.countryCode,
      employerKey: row.employerKey,
      roleKey: row.roleKey,
    },
    {
      ...question,
      countryCode: input.countryCode ?? null,
      countryConfirmed: input.countryConfirmed === true,
    },
  );
  if (!result.matched || !result.values)
    throw conflict(
      result.reason ?? "This saved answer does not match the current question and context.",
    );
  if (!sameAnswerValues(result.values, values))
    throw conflict(
      "The draft differs from the selected saved answer. Confirm it as a new answer instead.",
    );
  return row;
}
