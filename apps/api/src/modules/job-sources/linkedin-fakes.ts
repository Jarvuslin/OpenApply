import {
  type LinkedinIngestInput,
  linkedinSearchSchema,
} from "@openapply/contracts/linkedin-discovery";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import type { ListingSourceJob } from "@/modules/job-listing/listing-draft";
import { LinkedinDiscoveryService } from "./linkedin-discovery.service";
import type { EmployerResolver } from "./resolver";
import type { SourceJob } from "./types";

export const SEARCH = linkedinSearchSchema.parse({
  query: "junior developer",
  location: "Toronto, Canada",
});
export const LINKEDIN_JOB = {
  url: "https://www.linkedin.com/jobs/view/123",
  title: "Junior Software Engineer",
  company: "Acme",
  location: "Toronto, Canada",
  description: "1 year of experience required",
};

type Settings = {
  userId: string;
  enabled: boolean;
  searches: unknown;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  backoffUntil: Date | null;
};
type Run = {
  id: string;
  userId: string;
  searches: unknown;
  leaseHash: string;
  leaseExpiresAt: Date;
  status: string;
  payloadHash: string | null;
  processingUntil: Date | null;
  result: unknown;
  completedAt: Date | null;
};

export function linkedinFake(
  options: {
    unresolved?: boolean;
    employer?: Partial<SourceJob>;
    onResolve?: () => void;
    onPublish?: () => void;
  } = {},
) {
  const settings = new Map<string, Settings>();
  const runs = new Map<string, Run>();
  const published: { job: ListingSourceJob; userId: string }[] = [];
  let resolutionCount = 0;
  let tail = Promise.resolve();
  const db = {
    $queryRaw: async () => [{ id: "u1" }],
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await work(db);
      } finally {
        release();
      }
    },
    linkedinDiscoverySettings: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        settings.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Partial<Settings>;
        update: Partial<Settings>;
      }) => {
        const existing = settings.get(where.userId);
        const value = existing
          ? { ...existing, ...update }
          : ({ lastRunAt: null, nextRunAt: null, backoffUntil: null, ...create } as Settings);
        settings.set(where.userId, value);
        return value;
      },
      update: async ({ where, data }: { where: { userId: string }; data: Partial<Settings> }) => {
        const value = { ...settings.get(where.userId)!, ...data };
        settings.set(where.userId, value);
        return value;
      },
    },
    linkedinDiscoveryRun: {
      create: async ({ data }: { data: Partial<Run> }) => {
        const run = {
          id: crypto.randomUUID(),
          status: "claimed",
          payloadHash: null,
          processingUntil: null,
          result: null,
          completedAt: null,
          ...data,
        } as Run;
        runs.set(run.id, run);
        return run;
      },
      findFirst: async ({ where }: { where: { id?: string; userId: string; status?: string } }) => {
        const run = where.id
          ? runs.get(where.id)
          : [...runs.values()]
              .reverse()
              .find(
                (row) =>
                  row.userId === where.userId && (!where.status || row.status === where.status),
              );
        return run?.userId === where.userId ? run : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Run> }) => {
        const run = { ...runs.get(where.id)!, ...data };
        runs.set(where.id, run);
        return run;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; userId: string; status: string; payloadHash: string };
        data: Partial<Run>;
      }) => {
        const run = runs.get(where.id);
        if (
          !run ||
          run.userId !== where.userId ||
          run.status !== where.status ||
          run.payloadHash !== where.payloadHash
        )
          return { count: 0 };
        runs.set(where.id, { ...run, ...data });
        return { count: 1 };
      },
    },
  };
  const service = new LinkedinDiscoveryService(
    db as unknown as PrismaClient,
    {
      resolve: async (job: SourceJob) => {
        resolutionCount++;
        options.onResolve?.();
        if (options.unresolved) return { applyUrl: null, confidence: 0, matchedJob: null };
        const matchedJob = {
          ...job,
          url: "https://jobs.lever.co/acme/abc",
          attributionUrl: "https://jobs.lever.co/acme/abc",
          ...options.employer,
        };
        return { applyUrl: matchedJob.url, confidence: 1, matchedJob };
      },
    } as unknown as EmployerResolver,
    {
      publishPrivate: async (job: ListingSourceJob, userId: string) => {
        options.onPublish?.();
        published.push({ job, userId });
        return "created";
      },
    } as unknown as JobListingPublisher,
  );
  return { service, settings, runs, published, resolutionCount: () => resolutionCount };
}

export async function claimed(state: ReturnType<typeof linkedinFake>, searches = [SEARCH]) {
  await state.service.configure("u1", { enabled: true, searches });
  const claim = await state.service.claim("u1");
  const payload: LinkedinIngestInput = {
    runId: claim.runId,
    leaseToken: claim.leaseToken,
    searches: claim.searches.map((search) => ({
      index: search.index,
      status: "ok",
      httpStatus: 200,
      pagesFetched: 1,
      jobs: [LINKEDIN_JOB],
    })),
  };
  return { claim, payload };
}
