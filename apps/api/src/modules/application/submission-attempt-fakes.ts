import type { FitAssessment } from "@openapply/contracts/scoring";
import type { SubmissionCheckpointInput } from "@openapply/contracts/submission";
import type { PrismaClient, SubmissionAttempt } from "@/generated/prisma/client";
import type { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import type { SubmissionService } from "./submission.service";
import { SubmissionAttemptService } from "./submission-attempt.service";

export const ATTEMPT_WORK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ATTEMPT_LEASE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ATTEMPT_USER = "11111111-1111-4111-8111-111111111111";
export const ATTEMPT_CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_JOB = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_RESUME = "44444444-4444-4444-8444-444444444444";
export const ATTEMPT_VARIANT = "55555555-5555-4555-8555-555555555555";

export function checkpointInput(): SubmissionCheckpointInput {
  return {
    fields: [{ id: "name", label: "Full name", type: "text", value: "Example Candidate" }],
    resume: { jobId: ATTEMPT_JOB, sha256: "a".repeat(64), filename: "original.pdf" },
    resumeId: ATTEMPT_RESUME,
    review: {
      reviewedAt: new Date().toISOString(),
      summary: "Checked the job, every visible field, factual claims and selected PDF.",
      checks: { job: true, fields: true, resume: true, factualClaims: true },
      issues: [],
    },
  };
}

type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((part) => matches(row, part));
    if (key === "AND") return (value as Row[]).every((part) => matches(row, part));
    const actual = row[key];
    if (value instanceof Date)
      return actual instanceof Date && actual.getTime() === value.getTime();
    if (value && typeof value === "object") {
      const condition = value as Row;
      if ("equals" in condition) return JSON.stringify(actual) === JSON.stringify(condition.equals);
      if ("not" in condition) return actual !== condition.not;
      if ("in" in condition) return (condition.in as unknown[]).includes(actual);
      if ("notIn" in condition) return !(condition.notIn as unknown[]).includes(actual);
      if ("is" in condition)
        return condition.is === null
          ? actual === null
          : !!actual && matches(actual as Row, condition.is as Row);
      return !!actual && matches(actual as Row, condition);
    }
    return value === undefined || actual === value;
  });
}

export function attemptFixture() {
  const state = {
    work: {
      id: ATTEMPT_WORK,
      userId: ATTEMPT_USER,
      jobId: ATTEMPT_JOB,
      kind: "application",
      state: "filling",
      currentExecutionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      leaseToken: ATTEMPT_LEASE,
      leaseExpiresAt: new Date(Date.now() + 90000),
      pauseRequestedAt: null as Date | null,
      cancellationRequestedAt: null as Date | null,
    },
    jobs: [
      {
        id: ATTEMPT_JOB,
        campaignId: ATTEMPT_CAMPAIGN,
        key: "job",
        url: "https://employer.test/jobs/123",
        title: "Engineer",
        company: "Example",
        location: "Toronto",
        board: "employer",
        status: "applying",
        matchScore: 75,
        matchReason: "Original source fit",
        fitAssessment: null,
        appliedAt: null,
        failReason: null,
        skipReason: null,
        retryNotes: null,
        salary: null,
        type: null,
        description: null,
        digest: null,
        createdAt: new Date(),
        updatedAt: new Date(Date.now() - 5000),
        campaign: { userId: ATTEMPT_USER, source: "apply", status: "in_progress", config: {} },
      },
    ] as Row[],
    execution: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: ATTEMPT_USER,
      workItemId: ATTEMPT_WORK,
      jobId: ATTEMPT_JOB,
      kind: "application",
      canonicalUrl: "https://employer.test/jobs/123",
      companyKey: "example",
      domainKey: "employer.test",
      finishedAt: null,
      releasedAt: null,
      consumedAt: null,
    } as Row,
    attempts: [] as SubmissionAttempt[],
    applications: [] as Row[],
    pdfValid: true,
    verificationCount: 0,
    variantResumeId: ATTEMPT_RESUME,
    resumeDeleted: false,
    variantDeleted: false,
    failApplicationCreate: false,
    applicationWrites: 0,
    documentLinks: [] as Row[],
    artifactHash: "a".repeat(64),
    artifactReads: [] as unknown[][],
    currentFit: null as FitAssessment | null,
    fitReads: [] as unknown[][],
  };
  let tail = Promise.resolve();
  const rawDb = {
    queuePolicy: {
      findUnique: async () => ({
        userId: ATTEMPT_USER,
        revision: 1,
        maxConcurrentWorkers: 1,
        dailyApplicationCap: 10,
        companyApplicationCap: 3,
        companyWindowDays: 7,
        domainDelaySeconds: 30,
        updatedAt: new Date(),
      }),
    },
    workExecution: {
      findFirst: async ({ where }: { where: Row }) =>
        matches(state.execution, where) ? structuredClone(state.execution) : null,
      findMany: async ({ where }: { where: Row }) =>
        matches(state.execution, where) ? [structuredClone(state.execution)] : [],
      update: async ({ data }: { data: Row }) => Object.assign(state.execution, data),
    },
    applicationQuestion: { count: async () => 0, findMany: async () => [] },
    applicationDocumentSelection: { findMany: async () => [] },
    applicationQuestionAnswer: { findFirst: async () => null },
    jobQuestionCollection: { findFirst: async () => null },
    pilotQuestion: { count: async () => 0 },
    $queryRaw: async () => [],
    workItem: {
      findFirst: async ({ where }: { where: Row }) =>
        matches(state.work, where) ? structuredClone(state.work) : null,
      count: async () => 0,
    },
    job: {
      findFirst: async ({ where }: { where: Row }) =>
        structuredClone(state.jobs.find((job) => matches(job, where)) ?? null),
      findMany: async ({ where, include }: { where: Row; include?: Row }) =>
        structuredClone(
          state.jobs
            .map((job) => ({
              ...job,
              submissionAttempt: state.attempts.find((attempt) => attempt.jobId === job.id) ?? null,
            }))
            .filter((job) => matches(job, where))
            .map(({ submissionAttempt, ...job }) =>
              include?.submissionAttempt ? { ...job, submissionAttempt } : job,
            ),
        ),
      findUniqueOrThrow: async ({ where }: { where: Row }) =>
        structuredClone(state.jobs.find((job) => matches(job, where))!),
      count: async ({ where }: { where: Row }) =>
        state.jobs.filter((job) =>
          matches(
            {
              ...job,
              submissionAttempt: state.attempts.find((attempt) => attempt.jobId === job.id) ?? null,
            },
            where,
          ),
        ).length,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const job of state.jobs)
          if (
            matches(
              {
                ...job,
                submissionAttempt: state.attempts.find((row) => row.jobId === job.id) ?? null,
              },
              where,
            )
          ) {
            Object.assign(job, data);
            count++;
          }
        return { count };
      },
    },
    campaign: {
      findFirst: async () => ({ campaignId: ATTEMPT_CAMPAIGN, ...(state.jobs[0].campaign as Row) }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const job = state.jobs.find((item) =>
          matches({ campaignId: item.campaignId, ...(item.campaign as Row) }, where),
        );
        if (!job) return { count: 0 };
        for (const item of state.jobs.filter((row) => row.campaignId === job.campaignId))
          Object.assign(item.campaign as Row, data);
        return { count: 1 };
      },
    },
    submissionAttempt: {
      findFirst: async ({ where }: { where: Row }) =>
        structuredClone(state.attempts.find((row) => matches(row, where)) ?? null),
      findMany: async ({
        where,
        take = 100,
        cursor,
        skip = 0,
      }: {
        where: Row;
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const rows = state.attempts
          .filter((row) => matches(row, where))
          .sort((a, b) => a.id.localeCompare(b.id));
        const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
        return structuredClone(rows.slice(start, start + take));
      },
      findUniqueOrThrow: async ({ where }: { where: Row }) =>
        structuredClone(state.attempts.find((row) => matches(row, where))!),
      create: async ({ data }: { data: Row }) => {
        if (
          state.attempts.some(
            (row) =>
              row.jobId === data.jobId ||
              (row.userId === data.userId && row.canonicalUrl === data.canonicalUrl),
          )
        )
          throw Object.assign(new Error("Unique reservation"), { code: "P2002" });
        const row = {
          id: crypto.randomUUID(),
          checkpointId: null,
          checkpoint: null,
          checkpointHash: null,
          legacyOutcomeUnknown: false,
          startedAt: null,
          receipt: null,
          receiptHash: null,
          receiptStoredAt: null,
          recordedAt: null,
          applicationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as SubmissionAttempt;
        state.attempts.push(row);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of state.attempts)
          if (matches(row, where)) {
            Object.assign(row, data, { updatedAt: new Date() });
            count++;
          }
        return { count };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.attempts.find((item) => matches(item, where))!;
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
    resume: {
      findFirst: async ({ where }: { where: Row }) =>
        !state.resumeDeleted && where.id === ATTEMPT_RESUME && where.userId === ATTEMPT_USER
          ? { id: ATTEMPT_RESUME }
          : null,
    },
    resumeVariant: {
      findFirst: async ({ where }: { where: Row }) =>
        !state.resumeDeleted &&
        !state.variantDeleted &&
        where.id === ATTEMPT_VARIANT &&
        (where.resume as Row).userId === ATTEMPT_USER &&
        (where.resumeId === undefined || where.resumeId === state.variantResumeId)
          ? { id: ATTEMPT_VARIANT, resumeId: state.variantResumeId }
          : null,
      updateMany: async (data: Row) => {
        state.documentLinks.push(data);
        return { count: 1 };
      },
    },
    coverLetter: {
      updateMany: async (data: Row) => {
        state.documentLinks.push(data);
        return { count: 1 };
      },
    },
    jobListing: { findFirst: async () => null, findUnique: async () => null },
    application: {
      findFirst: async ({ where }: { where: Row }) =>
        structuredClone(state.applications.find((row) => matches(row, where)) ?? null),
      findUnique: async ({ where }: { where: Row }) => {
        const lookup = (where.userId_url ?? where) as Row;
        return structuredClone(state.applications.find((row) => matches(row, lookup)) ?? null);
      },
      findUniqueOrThrow: async ({ where }: { where: Row }) =>
        structuredClone(state.applications.find((row) => matches(row, where))!),
      findMany: async () => [],
      create: async ({ data }: { data: Row }) => {
        if (state.failApplicationCreate)
          throw new Error("Simulated application persistence outage");
        if (state.applications.some((row) => row.userId === data.userId && row.url === data.url))
          throw new Error("Duplicate application");
        const row = { id: crypto.randomUUID(), ...data };
        state.applications.push(row);
        state.applicationWrites++;
        return structuredClone(row);
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(state);
      try {
        return await work(rawDb);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      } finally {
        release();
      }
    },
  };
  const db = rawDb as unknown as PrismaClient;
  const files = {
    verifyResume: async (_user: string, jobId: string, resume: { jobId: string }) => {
      state.verificationCount++;
      if (!state.pdfValid || resume.jobId !== jobId) throw new Error("Retained PDF mismatch");
    },
    checkpointPdf: async () => new Response("%PDF-retained"),
  } as unknown as SubmissionService;
  const artifacts = {
    get: async (...args: unknown[]) => {
      state.artifactReads.push(args);
      return { pdfSha256: state.artifactHash };
    },
  } as unknown as ResumeArtifactService;
  const scoring = {
    currentAssessment: async (...args: unknown[]) => {
      state.fitReads.push([args[0], args[1], args[2] === db]);
      return state.currentFit;
    },
  } as unknown as ScoringService;
  const service = new SubmissionAttemptService(db, files, artifacts, scoring);
  const begin = (userId: string, campaignId: string, key: string, checkpointId: string) =>
    service.begin(userId, campaignId, key, checkpointId, ATTEMPT_WORK, ATTEMPT_LEASE);
  const prepare = async (input = checkpointInput()) =>
    (await service.checkpoint(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", input)).attempt!;
  const confirm = async (input = checkpointInput()) => {
    const prepared = await prepare(input);
    await begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!);
    const receipt = {
      checkpointId: prepared.checkpointId!,
      confirmation: {
        url: "https://ats.test/confirmation",
        text: "Your application was received.",
        observedAt: new Date().toISOString(),
      },
    };
    await service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt);
    return receipt;
  };
  return { state, db, files, service, begin, prepare, confirm };
}
