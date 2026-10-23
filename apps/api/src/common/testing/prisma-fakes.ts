import type { PrismaClient } from "@/generated/prisma/client";
import type { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { WorkQueueClaimService } from "@/modules/work-queue/work-queue.claim";
import { WorkQueueService } from "@/modules/work-queue/work-queue.service";

type Row = Record<string, unknown>;
type Query = {
  where?: Row;
  data?: Row;
  create?: Row;
  update?: Row;
  include?: Row;
  orderBy?: Row | Row[];
  skip?: number;
  take?: number;
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some((part) => matches(row, part));
    if (key === "AND") return (expected as Row[]).every((part) => matches(row, part));
    if (key === "NOT")
      return !(Array.isArray(expected) ? expected : [expected]).some((part) =>
        matches(row, part as Row),
      );
    if (key.includes("_")) return matches(row, expected as Row);
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const filter = expected as Row;
      if (filter.some)
        return (
          Array.isArray(actual) && actual.some((value) => matches(value as Row, filter.some as Row))
        );
      if (filter.notIn) return !(filter.notIn as unknown[]).includes(actual);
      if (filter.gte) return actual instanceof Date && actual >= (filter.gte as Date);
      if (filter.in) return (filter.in as unknown[]).includes(actual);
      if ("not" in filter) return actual !== filter.not;
      if (filter.gt) return actual instanceof Date && actual > (filter.gt as Date);
      if (filter.lt) return actual instanceof Date && actual < (filter.lt as Date);
      if (filter.lte) return actual instanceof Date && actual <= (filter.lte as Date);
      if (filter.contains)
        return String(actual).toLowerCase().includes(String(filter.contains).toLowerCase());
      if (filter.startsWith) return String(actual).startsWith(String(filter.startsWith));
      if (actual && typeof actual === "object") return matches(actual as Row, filter);
    }
    return actual === expected;
  });
}

export function prismaFixture() {
  const questions: Row[] = [];
  const pilotStates: Row[] = [];
  const jobs: Row[] = [];
  const workItems: Row[] = [];
  const workRequests: Row[] = [];
  const workEvents: Row[] = [];
  const queuePolicies: Row[] = [];
  const workExecutions: Row[] = [];
  const domainGates: Row[] = [];
  const submissions: Row[] = [];
  const applications: Row[] = [];
  const campaigns: Row[] = [];
  const searches: Row[] = [];
  const questionCollections: Row[] = [];
  const applicationQuestions: Row[] = [];
  const questionAnswers: Row[] = [];
  const documentSelections: Row[] = [];
  const preparationResults: Row[] = [];
  const resumes: Row[] = [];
  const variants: Row[] = [];
  const bankEntries: Row[] = [];
  const bankRevisions: Row[] = [];
  const locks: unknown[][] = [];
  let tail = Promise.resolve();

  function table(rows: Row[], defaults: () => Row = () => ({})) {
    function findMany(query: Query = {}) {
      let result = rows.filter((row) =>
        matches(
          {
            ...row,
            ...(row.questionId
              ? {
                  question: applicationQuestions.find((question) => question.id === row.questionId),
                }
              : {}),
            ...(row.identityHash
              ? { revisions: bankRevisions.filter((revision) => revision.entryId === row.id) }
              : {}),
          },
          query.where,
        ),
      );
      const sorts = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy ?? {}];
      result = [...result].sort((a, b) => {
        for (const sort of sorts) {
          for (const [key, direction] of Object.entries(sort)) {
            if (a[key] === b[key]) continue;
            if (direction && typeof direction === "object") {
              const options = direction as { sort: string; nulls: string };
              if (a[key] == null || b[key] == null) {
                const missing = a[key] == null ? 1 : -1;
                return options.nulls === "last" ? missing : -missing;
              }
              const comparison = (a[key] as string | number) > (b[key] as string | number) ? 1 : -1;
              return options.sort === "desc" ? -comparison : comparison;
            }
            const comparison = (a[key] as string | number) > (b[key] as string | number) ? 1 : -1;
            return direction === "desc" ? -comparison : comparison;
          }
        }
        return 0;
      });
      return result
        .slice(
          query.skip ?? 0,
          query.take === undefined ? undefined : (query.skip ?? 0) + query.take,
        )
        .map((row) => enrich(row, query));
    }
    function enrich(row: Row, query: Query): Row {
      const include = query.include;
      if (!include) return { ...row };
      return {
        ...row,
        ...(include.campaign
          ? {
              campaign:
                row.campaign ??
                campaigns.find((campaign) => campaign.campaignId === row.campaignId),
            }
          : {}),
        ...(include.job ? { job: jobs.find((job) => job.id === row.jobId) } : {}),
        ...(include.entry ? { entry: bankEntries.find((entry) => entry.id === row.entryId) } : {}),
        ...(include.question
          ? {
              question: enrich(
                applicationQuestions.find((question) => question.id === row.questionId) ?? {},
                include.question as Query,
              ),
            }
          : {}),
        ...(include.sourceAnswer
          ? {
              sourceAnswer: row.sourceAnswerId
                ? enrich(
                    questionAnswers.find((answer) => answer.id === row.sourceAnswerId) ?? {},
                    include.sourceAnswer as Query,
                  )
                : null,
            }
          : {}),
        ...(include.revisions
          ? {
              revisions: [...bankRevisions]
                .filter((revision) => revision.entryId === row.id)
                .sort((a, b) => Number(b.revision) - Number(a.revision))
                .slice(0, (include.revisions as Query).take)
                .map((revision) => enrich(revision, include.revisions as Query)),
            }
          : {}),
        ...(include.collection
          ? {
              collection: questionCollections.find(
                (collection) => collection.id === row.collectionId,
              ),
            }
          : {}),
        ...(include.answers
          ? {
              answers: [...questionAnswers]
                .filter((answer) => answer.questionId === row.id)
                .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
                .slice(0, (include.answers as Query).take ?? 1),
            }
          : {}),
      };
    }
    return {
      findMany: async (query?: Query) => findMany(query),
      findFirst: async (query: Query) => findMany(query)[0] ?? null,
      findUnique: async (query: Query) => findMany(query)[0] ?? null,
      findUniqueOrThrow: async (query: Query) => {
        const row = findMany(query)[0];
        if (!row) throw new Error("Missing row");
        return row;
      },
      groupBy: async (query: Query) => {
        const rows = findMany(query);
        return [...new Set(rows.map((row) => row.state))].map((state) => ({
          state,
          _count: rows.filter((row) => row.state === state).length,
        }));
      },
      count: async (query: Query) => findMany(query).length,
      create: async (query: Query) => {
        const row = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          ...defaults(),
          ...Object.fromEntries(
            Object.entries(query.data ?? {}).filter(([, value]) => value !== undefined),
          ),
        };
        rows.push(row);
        return enrich(row, query);
      },
      delete: async (query: Query) => {
        const index = rows.findIndex((row) => matches(row, query.where));
        if (index < 0) throw new Error("Missing row");
        return rows.splice(index, 1)[0];
      },
      deleteMany: async (query: Query) => {
        const selected = rows.filter((row) => matches(row, query.where));
        for (const row of selected) rows.splice(rows.indexOf(row), 1);
        return { count: selected.length };
      },
      update: async (query: Query) => {
        const row = rows.find((candidate) => matches(candidate, query.where));
        if (!row) throw new Error("Missing row");
        const changes = { ...query.data };
        for (const [key, value] of Object.entries(changes))
          if (value && typeof value === "object" && "increment" in value)
            changes[key] = Number(row[key] ?? 0) + Number(value.increment);
        Object.assign(row, changes);
        return enrich(row, query);
      },
      updateMany: async (query: Query) => {
        const selected = rows.filter((row) => matches(row, query.where));
        for (const row of selected) Object.assign(row, query.data);
        return { count: selected.length };
      },
      updateManyAndReturn: async (query: Query) =>
        rows
          .filter((row) => matches(row, query.where))
          .map((row) => {
            Object.assign(row, query.data);
            return { ...row };
          }),
      upsert: async (query: Query) => {
        const existing = rows.find((row) => matches(row, query.where));
        if (existing) {
          Object.assign(existing, query.update);
          return { ...existing };
        }
        const row = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          ...defaults(),
          ...query.create,
        };
        rows.push(row);
        return { ...row };
      },
    };
  }
  const db = {
    queuePolicy: table(queuePolicies),
    workExecution: table(workExecutions, () => ({
      finishedAt: null,
      releasedAt: null,
      consumedAt: null,
      submissionAttemptId: null,
      startedAt: new Date(),
    })),
    workDomainGate: table(domainGates),
    applicationDocumentSelection: table(documentSelections),
    applicationPreparationResult: table(preparationResults),
    resume: table(resumes),
    resumeVariant: table(variants),
    answerBankEntry: table(bankEntries, () => ({ updatedAt: new Date(), active: true })),
    answerBankRevision: table(bankRevisions),
    jobQuestionCollection: table(questionCollections, () => ({ observedAt: new Date() })),
    applicationQuestion: table(applicationQuestions),
    applicationQuestionAnswer: table(questionAnswers),
    workItem: table(workItems, () => ({
      priorityRequestedAt: null,
      state: "queued",
      provider: "claude",
      jobId: null,
      jobKey: null,
      campaignId: null,
      applicationId: null,
      company: null,
      reason: null,
      leaseToken: null,
      currentExecutionId: null,
      workerSlot: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      cancellationRequestedAt: null,
      pauseRequestedAt: null,
      attempts: 0,
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      intent: null,
      payload: {},
    })),
    workRequest: table(workRequests),
    workEvent: table(workEvents, () => ({ metadata: null })),
    submissionAttempt: table(submissions),
    application: table(applications),
    campaign: table(campaigns),
    pilotQuestion: table(questions, () => ({
      status: "open",
      subjectType: null,
      subjectId: null,
      applicationQuestionId: null,
      answer: null,
      answeredAt: null,
      expiresAt: null,
      deepLink: null,
      options: [],
    })),
    pilotState: table(pilotStates),
    pilotSearch: table(searches),
    job: table(jobs),
    $queryRaw: async (...args: unknown[]) => {
      locks.push(args);
      return [];
    },
    $transaction: async <T>(work: (tx: PrismaClient) => Promise<T>): Promise<T> => {
      let release = () => {};
      const before = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      const snapshots = [
        questions,
        workItems,
        workRequests,
        workEvents,
        queuePolicies,
        workExecutions,
        domainGates,
        submissions,
        applications,
        campaigns,
        questionCollections,
        applicationQuestions,
        questionAnswers,
        resumes,
        variants,
        documentSelections,
        preparationResults,
        bankEntries,
        bankRevisions,
      ].map((rows) => rows.map((row) => ({ ...row })));
      try {
        return await work(db as unknown as PrismaClient);
      } catch (error) {
        [
          questions,
          workItems,
          workRequests,
          workEvents,
          queuePolicies,
          workExecutions,
          domainGates,
          submissions,
          applications,
          campaigns,
          questionCollections,
          applicationQuestions,
          questionAnswers,
          resumes,
          variants,
          documentSelections,
          preparationResults,
          bankEntries,
          bankRevisions,
        ].forEach((rows, index) => {
          rows.splice(0, rows.length, ...(snapshots[index] ?? []));
        });
        throw error;
      } finally {
        release();
      }
    },
  };
  const runtimeId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const artifactReader = {
    get: async (..._args: unknown[]): Promise<unknown> => {
      throw new Error("Unexpected artifact read");
    },
  };
  const queue = new WorkQueueService(db as unknown as PrismaClient);
  const queueClaims = new WorkQueueClaimService(
    db as unknown as PrismaClient,
    queue,
    artifactReader as unknown as ResumeArtifactService,
    {
      preparationContext: async () => {
        throw new Error("Unexpected preparation source read");
      },
    } as unknown as ScoringService,
  );
  const compatibility = Object.assign(queue, {
    claim: async (userId: string) => {
      if (!queuePolicies.some((row) => row.userId === userId))
        queuePolicies.push({
          userId,
          revision: 1,
          maxConcurrentWorkers: 1,
          dailyApplicationCap: 10,
          companyApplicationCap: 3,
          companyWindowDays: 7,
          domainDelaySeconds: 30,
          updatedAt: new Date(),
        });
      await queue.refresh(userId);
      const candidates = workItems.filter((row) => row.userId === userId && row.state === "queued");
      for (const job of jobs)
        if (job.campaign && typeof job.campaign === "object") {
          (job.campaign as Row).config ??= {};
          if (!campaigns.some((row) => row.campaignId === job.campaignId))
            campaigns.push({ campaignId: job.campaignId, ...(job.campaign as Row) });
        }
      for (const campaign of campaigns) campaign.config ??= {};
      for (const item of candidates) {
        const claim = (
          await queueClaims.claim(userId, {
            requestId: crypto.randomUUID(),
            runtimeId,
            workerId,
            workItemId: String(item.id),
            capabilities: { isolatedBrowser: true },
          })
        ).claim;
        if (claim) return claim;
      }
      return null;
    },
  });
  return {
    queuePolicies,
    workExecutions,
    domainGates,
    queueClaims,
    artifactReader,
    questionCollections,
    applicationQuestions,
    questionAnswers,
    documentSelections,
    preparationResults,
    resumes,
    variants,
    bankEntries,
    bankRevisions,
    queue: compatibility,
    workItems,
    workRequests,
    workEvents,
    submissions,
    applications,
    campaigns,
    searches,
    db: db as unknown as PrismaClient,
    questions,
    pilotStates,
    jobs,
    locks,
  };
}
