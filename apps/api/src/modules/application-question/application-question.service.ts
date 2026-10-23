import {
  type AnswerApplicationQuestion,
  answerApplicationQuestionSchema,
  jobQuestionsSchema,
  type NeedsYouQuery,
  type QuestionObservation,
  questionObservationSchema,
} from "@openapply/contracts/application-question";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { saveConfirmedAnswer, validateSavedAnswer } from "@/modules/answer-bank/answer-bank.store";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { resolvedDocumentFields } from "./document.policy";
import { countNeedsYou, listNeedsYou } from "./question.needs-you";
import { storeObservation } from "./question.observations";
import { questionHash, validateAnswer } from "./question.policy";
import { resumeAnsweredJob } from "./question.resume";
import { questionInclude, questionView, recomputeQuestionBlockers } from "./question.store";
import { sameAnswerValues } from "./question.values";

function changed(userId: string, jobId: string) {
  publish(needsYouChannel, { userId }, { type: "needs-you.changed", jobId });
  publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
}

@singleton()
export class ApplicationQuestionService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string, jobId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const job = await tx.job.findFirst({ where: { id: jobId, campaign: { userId } } });
        if (!job) throw notFound("Job not found");
        const [collection, questions] = await Promise.all([
          tx.jobQuestionCollection.findFirst({
            where: { userId, jobId },
            orderBy: { version: "desc" },
          }),
          tx.applicationQuestion.findMany({
            where: { userId, jobId, current: true },
            include: questionInclude,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
        ]);
        return jobQuestionsSchema.parse({
          job,
          collectionVersion: collection?.version ?? 0,
          latestCollection: collection ? { ...collection, verification: "observed" } : null,
          questions: questions.map(questionView),
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async observe(userId: string, jobId: string, raw: QuestionObservation, authorship: AuthKind) {
    const input = questionObservationSchema.parse(raw);
    await this.prisma.$transaction((tx) => storeObservation(tx, userId, jobId, input, authorship));
    changed(userId, jobId);
    return this.get(userId, jobId);
  }

  async answer(userId: string, id: string, raw: AnswerApplicationQuestion, actor: HumanActor) {
    const input = answerApplicationQuestionSchema.parse(raw);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const question = await tx.applicationQuestion.findFirst({
        where: { id, userId },
        include: questionInclude,
      });
      if (!question) throw notFound("Application question not found");
      const payloadHash = questionHash({ id, input });
      const previous = await tx.applicationQuestionAnswer.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw conflict("Answer request ID was reused with different values.");
        return question;
      }
      if (
        !question.current ||
        question.revision !== input.expectedRevision ||
        question.definitionHash !== input.expectedDefinitionHash
      )
        throw conflict(
          "This question changed. Review its current wording and options before answering.",
        );
      const view = questionView(question);
      validateAnswer(
        view.definition,
        input.values,
        (await resolvedDocumentFields(tx, userId, question.jobId)).get(id),
      );
      const ownedJob = await tx.job.findUniqueOrThrow({ where: { id: question.jobId } });
      const usedBank = input.useSavedAnswer
        ? await validateSavedAnswer(
            tx,
            userId,
            {
              definition: view.definition,
              category: question.category,
              company: ownedJob.company,
              jobTitle: ownedJob.title,
            },
            input.useSavedAnswer,
            input.values,
          )
        : null;
      const savedAnswer = await tx.applicationQuestionAnswer.create({
        data: {
          questionId: id,
          userId,
          requestId: input.requestId,
          payloadHash,
          values: input.values,
          authorship,
          confirmedAt: new Date(),
          usedBankRevisionId: usedBank?.id ?? null,
          ...(input.useSavedAnswer
            ? {
                reuseContext: {
                  entryId: input.useSavedAnswer.entryId,
                  revision: input.useSavedAnswer.revision,
                  countryCode: input.useSavedAnswer.countryCode ?? null,
                  countryConfirmed: input.useSavedAnswer.countryConfirmed === true,
                },
              }
            : {}),
          createdAt: new Date(
            Math.max(Date.now(), (question.answers[0]?.createdAt.getTime() ?? 0) + 1),
          ),
        },
      });
      if (input.saveToProfile)
        await saveConfirmedAnswer(tx, userId, savedAnswer.id, input.saveToProfile, input.requestId);
      if (
        !question.answers[0]?.confirmedAt ||
        !sameAnswerValues(question.answers[0].values, input.values)
      ) {
        const job = await tx.job.findUniqueOrThrow({ where: { id: question.jobId } });
        await tx.job.update({
          where: { id: job.id },
          data: { updatedAt: new Date(Math.max(Date.now(), job.updatedAt.getTime() + 1)) },
        });
      }
      await recomputeQuestionBlockers(tx, userId, question.jobId);
      await resumeAnsweredJob(tx, userId, question.jobId);
      return tx.applicationQuestion.findUniqueOrThrow({ where: { id }, include: questionInclude });
    });
    changed(userId, result.jobId);
    return questionView(result);
  }

  list(userId: string, query: NeedsYouQuery) {
    return listNeedsYou(this.prisma, userId, query);
  }
  count(userId: string) {
    return countNeedsYou(this.prisma, userId);
  }
}
