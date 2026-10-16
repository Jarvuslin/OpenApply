import { jobQuestionsSchema } from "@openapply/contracts/application-question";
import {
  type IntakePreparationFit,
  type IntakePreparationPosting,
  type IntakePreparationQuestions,
  intakePreparationContextSchema,
  intakePreparationFitSchema,
  intakePreparationPostingSchema,
  intakePreparationQuestionsSchema,
} from "@openapply/contracts/intake-preparation";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { HttpError, notFound } from "@/common/errors";
import { publish } from "@/common/sse";
import { type Prisma, PrismaClient, type WorkItem } from "@/generated/prisma/client";
import { storeObservation } from "@/modules/application-question/question.observations";
import { questionInclude, questionView } from "@/modules/application-question/question.store";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { jobCriteria } from "@/modules/scoring/criteria";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { preparationCredential, validatePreparation } from "./preparation.snapshot";

@singleton()
export class IntakePreparationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scoring: ScoringService,
  ) {}

  async plan(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await tx.workItem.findFirst({ where: { id, userId } });
      if (!item) throw notFound("Owned preparation work not found.");
      return (await validatePreparation(tx, this.scoring, userId, item)).snapshot;
    });
  }

  private async withCapability<T>(
    authorization: string | undefined,
    operation: (
      tx: Prisma.TransactionClient,
      item: WorkItem,
      scope: Awaited<ReturnType<typeof validatePreparation>>,
    ) => Promise<T>,
  ) {
    const credential = preparationCredential(authorization);
    return this.prisma.$transaction(
      async (tx) => {
        const owner = await tx.workItem.findUnique({
          where: { id: credential.workItemId },
          select: { userId: true },
        });
        if (!owner) throw notFound("Preparation capability not found.");
        await lockWorkUser(tx, owner.userId);
        const item = await tx.workItem.findFirst({
          where: { id: credential.workItemId, userId: owner.userId },
        });
        if (!item) throw notFound("Preparation work no longer exists.");
        const scope = await validatePreparation(
          tx,
          this.scoring,
          owner.userId,
          item,
          credential.leaseToken,
        );
        const result = await operation(tx, item, scope);
        // Disk reads and validation may outlive the short lease. Roll back if it ended meanwhile.
        await validatePreparation(tx, this.scoring, owner.userId, item, credential.leaseToken);
        return result;
      },
      { timeout: 30_000 },
    );
  }

  private async questions(tx: Prisma.TransactionClient, userId: string, job: { id: string }) {
    const [collection, questions] = await Promise.all([
      tx.jobQuestionCollection.findFirst({
        where: { userId, jobId: job.id },
        orderBy: { version: "desc" },
      }),
      tx.applicationQuestion.findMany({
        where: { userId, jobId: job.id, current: true },
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
  }

  context(authorization: string | undefined) {
    return this.withCapability(authorization, async (tx, item, scope) => {
      let fit = null;
      try {
        fit = await this.scoring.context(
          item.userId,
          {
            campaignId: scope.snapshot.campaignId,
            jobKey: scope.snapshot.jobKey,
            resumeId: scope.snapshot.resumeId,
          },
          tx,
        );
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 422) throw error;
      }
      return intakePreparationContextSchema.parse({
        snapshot: scope.snapshot,
        job: scope.context.job,
        resume: scope.context.resume,
        fit,
        questions: await this.questions(tx, item.userId, scope.job),
      });
    });
  }

  async posting(authorization: string | undefined, raw: IntakePreparationPosting) {
    const input = intakePreparationPostingSchema.parse(raw);
    const result = await this.withCapability(authorization, async (tx, item, scope) => {
      jobCriteria(input.description, scope.job.title, scope.job.company);
      const job = await tx.job.update({
        where: { id: scope.job.id },
        data: { description: input.description },
      });
      return { userId: item.userId, job };
    });
    publishJob(result.userId, result.job, "updated");
    return { ok: true as const };
  }

  fit(authorization: string | undefined, raw: IntakePreparationFit) {
    const input = intakePreparationFitSchema.parse(raw);
    return this.withCapability(authorization, (tx, item, { snapshot }) =>
      this.scoring.scoreJobFit(
        item.userId,
        {
          ...input,
          campaignId: snapshot.campaignId,
          jobKey: snapshot.jobKey,
          resumeId: snapshot.resumeId,
        },
        tx,
      ),
    );
  }

  async observe(authorization: string | undefined, raw: IntakePreparationQuestions) {
    const input = intakePreparationQuestionsSchema.parse(raw);
    const result = await this.withCapability(authorization, async (tx, item, { job }) => {
      await storeObservation(tx, item.userId, job.id, input, "agent");
      return {
        userId: item.userId,
        jobId: job.id,
        questions: await this.questions(tx, item.userId, job),
      };
    });
    publish(
      needsYouChannel,
      { userId: result.userId },
      { type: "needs-you.changed", jobId: result.jobId },
    );
    publish(workQueueChannel, { userId: result.userId }, { type: "work-queue.changed" });
    return result.questions;
  }
}
