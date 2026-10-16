// Shared fake-Prisma scaffolding for the CampaignJobService suites: one mutable job row plus the
// application/variant/cover-letter writes its result path touches.

import type { FitAssessment } from "@openapply/contracts/scoring";
import { DAY_MS } from "@/common/date/buckets";
import { Prisma, type PrismaClient, type SubmissionAttempt } from "@/generated/prisma/client";
import type { SubmissionService } from "@/modules/application/submission.service";
import type { JobListingPublisher } from "@/modules/job-listing";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { claimJobForApply, guardApply } from "./apply-guard";
import { CampaignJobService } from "./job.service";

/** Relative to now, so the duplicate fixtures stay inside the window as the calendar moves. */
export const APPLIED_AT = new Date(Date.now() - 5 * DAY_MS).toISOString();

const OWNED_RESUME_ID = "11111111-1111-4111-8111-111111111111";
const OWNED_VARIANT_ID = "22222222-2222-4222-8222-222222222222";

export const FIT_ASSESSMENT: FitAssessment = {
  basis: {
    version: 1,
    resumeId: OWNED_RESUME_ID,
    sourceSha256: "a".repeat(64),
    sourceTextSha256: "b".repeat(64),
    jobSha256: "c".repeat(64),
    preferencesSha256: "d".repeat(64),
  },
  score: 90,
  confidence: 1,
  confidenceMeaning:
    "Fraction of scored criteria without an uncertain rating; not a probability of hiring.",
  judgment:
    "Semantic ratings are agent judgments; source quotations and score arithmetic are validated by the server.",
  verdict: "assessed",
  components: {
    requirements: { score: 90, count: 1, weight: 1 },
    responsibilities: { score: null, count: 0, weight: 0 },
  },
  assessments: [
    {
      criterionId: "r1",
      category: "requirement",
      rating: "strong",
      evidence: [{ start: 0, end: 10, quote: "TypeScript" }],
      explanation: "Original resume names TypeScript.",
      criterion: {
        id: "r1",
        start: 0,
        end: 10,
        text: "TypeScript",
        section: "requirements",
        isHeading: false,
      },
    },
  ],
  roleMatch: {
    family: "Frontend",
    evidence: [{ source: "title", start: 0, end: 8, quote: "Frontend" }],
    explanation: "Frontend posting.",
    relevance: "matched",
  },
  strongMatches: ["TypeScript"],
  partialMatches: [],
  gaps: [],
  matchReason: "Original resume supports the requirements.",
};

export function setup(beforeLock: () => Promise<void> = async () => {}) {
  let job = {
    id: "j-id",
    campaignId: "c1",
    key: "j1",
    title: "Engineer",
    company: "Acme",
    location: null,
    salary: null,
    type: null,
    url: "https://example.test/jobs/1",
    board: "example",
    matchScore: 90,
    matchReason: "fit",
    fitAssessment: null as FitAssessment | null,
    status: "applying",
    appliedAt: null,
    failReason: null,
    retryNotes: null,
    skipReason: null,
    description: null,
    digest: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let application: Record<string, unknown> | null = null;
  let attempt: SubmissionAttempt | null = null;
  let applicationUpserts = 0;
  let assessmentCurrent = true;
  const variantLinks: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const coverLetterLinks: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const campaign = { source: "auto_apply" as const };
  const db = {
    // No job here was put in the queue by the person, so search-list rules stay on.
    workItem: { count: async () => 0 },
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("FROM users")) await beforeLock();
      return [];
    },
    submissionAttempt: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; OR: { jobId?: string; canonicalUrl?: string }[] };
      }) =>
        attempt &&
        attempt.userId === where.userId &&
        where.OR.some(
          (part) =>
            (part.jobId !== undefined && part.jobId === attempt?.jobId) ||
            (part.canonicalUrl !== undefined && part.canonicalUrl === attempt?.canonicalUrl),
        )
          ? attempt
          : null,
      findMany: async ({ where }: { where: { userId: string; legacyOutcomeUnknown?: boolean } }) =>
        attempt?.userId === where.userId &&
        attempt.legacyOutcomeUnknown === where.legacyOutcomeUnknown
          ? [attempt]
          : [],
    },
    job: {
      findFirst: async () => ({ ...job, campaign }),
      // The applying-duplicate scan; no sibling job is mid-apply in these tests.
      findMany: async () => [],
      updateMany: async ({
        where,
        data,
      }: {
        where: { status?: unknown; updatedAt?: Date };
        data: Record<string, unknown>;
      }) => {
        if (where.status && typeof where.status === "object" && "notIn" in where.status) {
          if (["applied", "failed", "skipped"].includes(job.status)) return { count: 0 };
        } else if (typeof where.status === "string" && job.status !== where.status) {
          return { count: 0 };
        }
        if (where.updatedAt && where.updatedAt.getTime() !== job.updatedAt.getTime())
          return { count: 0 };
        job = {
          ...job,
          ...data,
          ...(data.fitAssessment === Prisma.DbNull && { fitAssessment: null }),
        } as typeof job;
        return { count: 1 };
      },
      updateManyAndReturn: async ({
        where,
        data,
      }: {
        where: { status?: string | { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        const allowed = typeof where.status === "string" ? [where.status] : where.status?.in;
        if (allowed && !allowed.includes(job.status)) return [];
        job = { ...job, ...data } as typeof job;
        return [job];
      },
      findUniqueOrThrow: async () => job,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        job = { ...job, ...data } as typeof job;
        return job;
      },
      groupBy: async () => [
        { campaignId: job.campaignId, status: job.status, _count: { _all: 1 } },
      ],
    },
    application: {
      findUnique: async () => application,
      findMany: async () => (application ? [application] : []),
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        applicationUpserts += 1;
        application = application ? { ...application, ...update } : { id: "app1", ...create };
        return application;
      },
    },
    campaign: {
      findUniqueOrThrow: async () => campaign,
    },

    resume: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === OWNED_RESUME_ID && where.userId === "u1" ? { id: OWNED_RESUME_ID } : null,
    },
    resumeVariant: {
      findFirst: async ({ where }: { where: { id: string; resume: { userId: string } } }) =>
        where.id === OWNED_VARIANT_ID && where.resume.userId === "u1"
          ? { id: OWNED_VARIANT_ID, resumeId: OWNED_RESUME_ID }
          : null,
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        variantLinks.push(args);
        return { count: 1 };
      },
    },
    coverLetter: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        coverLetterLinks.push(args);
        return { count: 1 };
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const listings = { publishInBackground: () => undefined } as unknown as JobListingPublisher;
  const verifiedResumes: unknown[] = [];
  const submissionFiles = {
    verifyResume: async (...args: unknown[]) => {
      verifiedResumes.push(args);
    },
  } as unknown as SubmissionService;
  const scoring = {
    currentAssessment: async () => (assessmentCurrent ? job.fitAssessment : null),
  } as unknown as ScoringService;
  const service = new CampaignJobService(
    db as unknown as PrismaClient,
    listings,
    submissionFiles,
    scoring,
  );
  return {
    service,
    verifiedResumes,
    /** The pilot's claim: the move runs inside a transaction wrapped in the duplicate guard. */
    claim: () =>
      guardApply(db as unknown as PrismaClient, "u1", () =>
        claimJobForApply(db as unknown as Prisma.TransactionClient, "u1", "c1", "j1", scoring),
      ),
    get job() {
      return job;
    },
    get applicationUpserts() {
      return applicationUpserts;
    },
    variantLinks,
    coverLetterLinks,
    setStatus(status: string) {
      job = { ...job, status };
    },
    setAttempt(value: Partial<SubmissionAttempt> | null) {
      attempt = value && {
        id: "55555555-5555-4555-8555-555555555555",
        userId: "u1",
        jobId: job.id,
        originalUrl: job.url,
        canonicalUrl: job.url,
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
        ...value,
      };
    },
    setAssessment(assessment: FitAssessment | null) {
      job = { ...job, fitAssessment: assessment, matchScore: assessment?.score ?? job.matchScore };
    },
    invalidateAssessment() {
      assessmentCurrent = false;
    },
    setApplication(row: Record<string, unknown>) {
      application = row;
    },
  };
}
