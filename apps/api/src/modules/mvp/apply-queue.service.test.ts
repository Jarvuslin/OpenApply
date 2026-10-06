import type { PrismaClient } from "@/generated/prisma/client";
import type { PilotJournalService } from "@/modules/pilot/journal.service";
import { ApplyQueueService } from "./apply-queue.service";
import { startInput } from "./mvp.schema";
import { describe, expect, it } from "bun:test";

function fixture() {
  const campaigns: { campaignId: string; config: object }[] = [];
  const writes: { url: string; campaignId: string; status: string }[] = [];
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
    listing("old", "https://jobs.ashbyhq.com/acme/old"),
  ];
  let locks = 0;
  const db = {
    $queryRaw: async () => {
      locks++;
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
        const row = { campaignId: "standing", config: data.config };
        campaigns.push(row);
        return row;
      },
      update: async () => null,
    },
    jobListing: { findMany: async () => listings },
    job: {
      findMany: async () => writes,
      createManyAndReturn: async ({ data }: { data: typeof writes }) => {
        writes.push(...data);
        return data;
      },
    },
    application: {
      findUnique: async ({ where }: { where: { userId_url: { url: string } } }) =>
        where.userId_url.url.endsWith("/old") ? { id: "applied" } : null,
    },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  } as unknown as PrismaClient;
  const journal = { appendJournal: async () => null } as unknown as PilotJournalService;
  return { service: new ApplyQueueService(prisma, journal), campaigns, writes, locks: () => locks };
}
describe("standing apply queue", () => {
  it("queues multiple selections and skips duplicates, blocked and unresolved sources", async () => {
    const { service, writes, campaigns, locks } = fixture();
    const first = await service.enqueue("user", [
      "one",
      "one",
      "blocked",
      "unresolved",
      "old",
      "missing",
    ]);
    expect(first.queued).toEqual(["one"]);
    expect(first.skipped.map((row) => row.slug)).toEqual([
      "one",
      "blocked",
      "unresolved",
      "old",
      "missing",
    ]);
    const second = await service.enqueue("user", ["one", "two"]);
    expect(second.campaignId).toBe(first.campaignId);
    expect(second.queued).toEqual(["two"]);
    expect(second.skipped).toEqual([{ slug: "one", reason: "Already queued or applied" }]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].config).toEqual({
      standing: true,
      resumeId: "00000000-0000-4000-8000-000000000001",
    });
    expect(writes).toHaveLength(2);
    expect(writes.every((row) => row.status === "approved" && !row.url.includes("indeed"))).toBe(
      true,
    );
    expect(locks()).toBe(2);
  });
  it("validates the batch bounds", () => {
    expect(startInput.safeParse({ slugs: [] }).success).toBe(false);
    expect(startInput.safeParse({ slugs: Array(101).fill("x") }).success).toBe(false);
    expect(startInput.safeParse({ slugs: ["one", "two"] }).success).toBe(true);
  });
});
