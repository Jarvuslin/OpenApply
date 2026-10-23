import type { Prisma, PrismaClient, WorkItem } from "@/generated/prisma/client";
import { CAMPAIGN_ID, JOB_KEY, scoringContext } from "@/modules/scoring/fakes";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { IntakePreparationService } from "./intake-preparation.service";
import { preparationSnapshot } from "./preparation.snapshot";

export function preparationFixture() {
  const userId = crypto.randomUUID(),
    workItemId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    intakeId = crypto.randomUUID();
  const context = scoringContext();
  const snapshot = preparationSnapshot({
    version: 1,
    purpose: "intake_prepare",
    workItemId,
    intakeId,
    intakeRevision: 2,
    jobId,
    campaignId: CAMPAIGN_ID,
    jobKey: JOB_KEY,
    url: context.job.url,
    provider: "codex",
    resumeId: context.basis.resumeId,
    sourceSha256: context.basis.sourceSha256,
    sourceTextSha256: context.basis.sourceTextSha256,
    preferencesSha256: context.basis.preferencesSha256,
  });
  const item: WorkItem = {
    id: workItemId,
    userId,
    kind: "pilot_task",
    intent: "intake_prepare",
    campaignId: CAMPAIGN_ID,
    provider: "codex",
    payload: snapshot,
    state: "preparing",
    attempts: 1,
    autoRetries: 0,
    leaseToken: crypto.randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 90_000),
    currentExecutionId: crypto.randomUUID(),
    cancellationRequestedAt: null,
    pauseRequestedAt: null,
    finishedAt: null,
    source: "user",
    identity: `intake-prepare:${intakeId}`,
    priorityRequestedAt: null,
    jobId: null,
    jobKey: null,
    applicationId: null,
    title: "Prepare fixture",
    company: "Example",
    reason: null,
    workerSlot: 1,
    heartbeatAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
  };
  const job = {
    ...context.job,
    id: jobId,
    campaignId: CAMPAIGN_ID,
    key: JOB_KEY,
    status: "pending",
    updatedAt: new Date(),
    campaign: { config: { resumeId: snapshot.resumeId }, userId, status: "in_progress" },
  };
  const intake = {
    id: intakeId,
    userId,
    revision: 2,
    decision: "pending",
    jobId,
    canonicalUrl: snapshot.url,
    provider: "codex",
    resolved: true,
  };
  const execution = {
    id: item.currentExecutionId,
    userId,
    workItemId,
    kind: "pilot_task",
    finishedAt: null as Date | null,
    releasedAt: null as Date | null,
  };
  const state = {
    sourceReads: 0,
    writes: 0,
    locks: 0,
    afterSource: null as (() => void) | null,
    attempt: null as Record<string, unknown> | null,
  };
  const scoring = {
    preparationContext: async (
      _user: string,
      input: { resumeId: string; campaignId: string; jobKey: string },
    ) => {
      if (
        _user !== userId ||
        input.resumeId !== snapshot.resumeId ||
        input.campaignId !== snapshot.campaignId ||
        input.jobKey !== snapshot.jobKey
      )
        throw new Error("Wrong preparation source scope");
      state.sourceReads++;
      state.afterSource?.();
      return { ...context, job: { ...context.job, description: job.description } };
    },
    context: async () => context,
  } as unknown as ScoringService;
  const db = {
    $queryRaw: async (_parts: TemplateStringsArray, owner: string) => {
      state.locks++;
      return [{ id: owner }];
    },
    workItem: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === item.id ? item : null,
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === item.id && where.userId === userId ? item : null,
    },
    workExecution: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; userId: string; workItemId: string };
      }) =>
        where.id === execution.id &&
        where.userId === userId &&
        where.workItemId === item.id &&
        !execution.finishedAt &&
        !execution.releasedAt
          ? execution
          : null,
    },
    jobIntake: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === intake.id && where.userId === intake.userId ? intake : null,
    },
    job: {
      findFirst: async ({ where }: { where: { id: string; campaign: { userId: string } } }) =>
        where.id === job.id && where.campaign.userId === job.campaign.userId ? job : null,
      update: async ({ where, data }: { where: { id: string }; data: { description: string } }) => {
        if (where.id !== jobId) throw new Error("Wrong posting write target");
        state.writes++;
        Object.assign(job, data);
        return job;
      },
    },
    submissionAttempt: { findFirst: async () => state.attempt, findMany: async () => [] },
    jobQuestionCollection: { findFirst: async () => null },
    applicationQuestion: { findMany: async () => [] },
  };
  const client = {
    ...db,
    $transaction: async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => {
      const saved = { job: structuredClone(job), writes: state.writes };
      try {
        return await run(db as unknown as Prisma.TransactionClient);
      } catch (error) {
        Object.assign(job, saved.job);
        state.writes = saved.writes;
        throw error;
      }
    },
  } as unknown as PrismaClient;
  const authorization = `Bearer prep.${item.id}.${item.leaseToken}`;
  return {
    userId,
    item,
    job,
    intake,
    execution,
    snapshot,
    context,
    state,
    scoring,
    client,
    tx: db as unknown as Prisma.TransactionClient,
    authorization,
    service: new IntakePreparationService(client, scoring),
  };
}
