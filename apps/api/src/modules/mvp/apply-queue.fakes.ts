import type { PrismaClient } from "@/generated/prisma/client";
import type { PilotJournalService } from "@/modules/pilot/journal.service";
import { ApplyQueueService } from "./apply-queue.service";

export function applyQueueFixture() {
  const campaigns: { campaignId: string; config: object; status: string }[] = [];
  const writes: { id: string; url: string; campaignId: string; status: string; key: string }[] = [];
  const requests = new Map<
    string,
    {
      userId: string;
      idempotencyKey: string;
      payloadHash: string;
      response?: unknown;
      itemIds: string[];
    }
  >();
  const workItems: { id: string; jobId: string; provider: string }[] = [];
  const intakes: {
    id: string;
    userId: string;
    canonicalUrl: string;
    originalUrl: string;
    decision: "pending" | "skip" | "queue" | "apply_now";
  }[] = [];
  const listing = (slug: string, applyUrl: string | null) => ({
    slug,
    title: slug,
    company: "Employer",
    location: "Toronto",
    descriptionExcerpt: "Role",
    sources: [{ applyUrl, board: "test" }],
  });
  const listings = [
    listing("one", "https://jobs.ashbyhq.com/acme/1"),
    listing("two", "https://jobs.ashbyhq.com/acme/2"),
    listing("blocked", "https://ca.indeed.com/job/3"),
    listing("unresolved", null),
    listing("linkedin", "https://www.linkedin.com/jobs/view/123456"),
    listing("old", "https://jobs.ashbyhq.com/acme/old"),
  ];
  let locks = 0;
  const activeQueries: { where: { campaign: { userId: string }; status: { in: string[] } } }[] = [];
  const applicationQueries: { where: { userId_url: { userId: string; url: string } } }[] = [];
  const listingQueries: Record<string, unknown>[] = [];
  const db = {
    $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = query.join("?");
      if (sql.includes("FROM users")) {
        locks++;
        return [{ id: values[0] }];
      }
      if (sql.includes("FROM job_intakes")) {
        const [userId, canonicalUrl, originalUrl] = values;
        return intakes
          .filter(
            (row) =>
              row.userId === userId &&
              (row.canonicalUrl === canonicalUrl || row.originalUrl === originalUrl) &&
              ["pending", "skip"].includes(row.decision),
          )
          .map(({ id }) => ({ id }));
      }
      if (sql.includes("FROM application_rules")) return [];
      throw new Error("Unexpected standing queue fixture query.");
    },
    user: {
      findUniqueOrThrow: async () => ({
        firstName: "Test",
        lastName: "Applicant",
        contactEmail: "test@example.com",
        primaryResumeId: "00000000-0000-4000-8000-000000000001",
      }),
    },
    pilotQuestion: { findFirst: async () => null },
    campaign: {
      findMany: async () => campaigns,
      create: async ({ data }: { data: { config: object } }) => {
        const row = { campaignId: "standing", config: data.config, status: "in_progress" };
        campaigns.push(row);
        return row;
      },
      update: async () => null,
    },
    jobListing: {
      findMany: async (query: Record<string, unknown>) => {
        listingQueries.push(query);
        return listings;
      },
    },
    job: {
      findMany: async (query: {
        where: {
          status?: { in: string[] };
          campaign?: { userId: string };
          campaignId?: string;
          key?: { in: string[] };
          id?: { in: string[] };
        };
        include?: object;
      }) => {
        if (query.where.status && query.where.campaign) {
          activeQueries.push({
            where: { status: query.where.status, campaign: query.where.campaign },
          });
          return writes.filter((row) => query.where.status!.in.includes(row.status));
        }
        if (query.where.id)
          return writes
            .filter((row) => query.where.id!.in.includes(row.id))
            .map((row) => ({
              ...row,
              campaign: campaigns.find((campaign) => campaign.campaignId === row.campaignId),
              submissionAttempt: null,
            }));
        return writes.filter(
          (row) =>
            row.campaignId === query.where.campaignId && query.where.key?.in.includes(row.key),
        );
      },
      createManyAndReturn: async ({ data }: { data: Omit<(typeof writes)[number], "id">[] }) => {
        const created = data.map((row) => ({ ...row, id: crypto.randomUUID() }));
        writes.push(...created);
        return created;
      },
    },
    submissionAttempt: { findFirst: async () => null, findMany: async () => [] },
    workItem: {
      findUnique: async ({ where }: { where: { jobId: string } }) =>
        workItems.find((row) => row.jobId === where.jobId) ?? null,
      create: async ({ data }: { data: Omit<(typeof workItems)[number], "id"> }) => {
        const row = { ...data, id: crypto.randomUUID() };
        workItems.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        workItems.filter((row) => where.id.in.includes(row.id)),
    },
    workRequest: {
      findUnique: async ({
        where,
      }: {
        where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
      }) =>
        requests.get(
          `${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          idempotencyKey: string;
          payloadHash: string;
          response?: unknown;
          itemIds: string[];
        };
      }) => {
        requests.set(`${data.userId}:${data.idempotencyKey}`, data);
        return data;
      },
    },
    application: {
      findUnique: async (query: (typeof applicationQueries)[number]) => {
        applicationQueries.push(query);
        return query.where.userId_url.url.endsWith("/old") ? { id: "applied" } : null;
      },
    },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  } as unknown as PrismaClient;
  const journal = { appendJournal: async () => null } as unknown as PilotJournalService;
  return {
    service: new ApplyQueueService(prisma, journal),
    campaigns,
    writes,
    workItems,
    intakes,
    activeQueries,
    applicationQueries,
    listingQueries,
    locks: () => locks,
  };
}
