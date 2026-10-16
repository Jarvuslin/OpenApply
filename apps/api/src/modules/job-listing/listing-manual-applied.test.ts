import type { PrismaClient } from "@/generated/prisma/client";
import { JobListingService } from "./job-listing.service";
import { describe, expect, it, spyOn } from "bun:test";

type ApplicationRow = {
  id: string;
  userId: string;
  url: string;
  listingId: string;
  source: string;
  status: string;
  campaignId: string | null;
  submission: unknown;
  submissionAttempt: { id: string } | null;
  appliedAt: Date;
};
function fixture(initial: ApplicationRow[] = []) {
  const rows = [...initial];
  const writes: Record<string, unknown>[] = [];
  const db = {
    application: {
      update: async ({
        where,
        data,
      }: {
        where: { userId_url: { userId: string; url: string } };
        data: { listingId: string };
      }) => {
        const row = rows.find(
          (row) => row.userId === where.userId_url.userId && row.url === where.userId_url.url,
        );
        if (!row) throw new Error("Missing application");
        row.listingId = data.listingId;
        return row;
      },
      upsert: async (args: {
        where: { userId_url: { userId: string; url: string } };
        create: Pick<ApplicationRow, "userId" | "url" | "listingId" | "source"> &
          Partial<ApplicationRow>;
        update: { listingId: string };
      }) => {
        writes.push(args as unknown as Record<string, unknown>);
        const key = args.where.userId_url;
        const existing = rows.find((row) => row.userId === key.userId && row.url === key.url);
        if (existing) {
          existing.listingId = args.update.listingId;
          return existing;
        }
        const row = {
          status: "applied",
          campaignId: null,
          submission: null,
          submissionAttempt: null,
          appliedAt: new Date(),
          ...args.create,
          id: crypto.randomUUID(),
        };
        rows.push(row);
        return row;
      },
      deleteMany: async (args: {
        where: {
          userId: string;
          id: string;
          listingId: string;
          source: string;
          status: string;
          campaignId: null;
          submission: unknown;
          submissionAttempt: unknown;
        };
      }) => {
        writes.push(args as unknown as Record<string, unknown>);
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (
            row.id === args.where.id &&
            row.userId === args.where.userId &&
            row.listingId === args.where.listingId &&
            row.source === args.where.source &&
            row.status === args.where.status &&
            row.campaignId === null &&
            row.submission === null &&
            row.submissionAttempt === null
          ) {
            rows.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
  } as unknown as PrismaClient;
  const service = new JobListingService(db);
  service.bySlugForUser = async (userId, slug) => {
    const application = rows.find((row) => row.userId === userId && row.listingId === "listing");
    return {
      id: "listing",
      slug,
      title: "Engineer",
      company: "Example",
      location: "Toronto",
      isApplied: Boolean(application),
      applicationId: application?.id ?? null,
      appliedAt: application?.appliedAt ?? null,
      canUndoApplied: application?.source === "manual" && application.status === "applied",
      sources: [
        {
          url: "https://example.com/jobs/1?utm_source=board",
          applyUrl: "https://example.com/jobs/1",
          board: "employer",
        },
      ],
    } as Awaited<ReturnType<JobListingService["bySlugForUser"]>>;
  };
  return { service, rows, writes, db };
}

function confirmed(userId = "alice"): ApplicationRow {
  return {
    id: crypto.randomUUID(),
    userId,
    url: "https://example.com/jobs/1",
    listingId: "listing",
    source: "apply",
    status: "applied",
    campaignId: "campaign",
    submission: { confirmation: "retained" },
    submissionAttempt: { id: "receipt" },
    appliedAt: new Date("2026-10-01"),
  };
}

describe("manual applied marking", () => {
  it("rejects agent credentials before creating a receipt-free application", async () => {
    const f = fixture();
    await expect(f.service.markApplied("alice", "example", "agent")).rejects.toThrow(
      "confirmed submission receipt",
    );
    await expect(f.service.undoApplied("alice", "example", "agent")).rejects.toThrow(
      "signed-in person",
    );
    expect(f.writes).toHaveLength(0);
  });
  it("creates one manual application when requests race and keeps another user's history separate", async () => {
    const f = fixture([confirmed("bob")]);
    const results = await Promise.all([
      f.service.markApplied("alice", "example", "session_user"),
      f.service.markApplied("alice", "example", "session_user"),
    ]);
    expect(results[0].applicationId).toBe(results[1].applicationId);
    expect(results[0]).toMatchObject({ isApplied: true, canUndoApplied: true });
    expect(f.rows.filter((row) => row.userId === "alice")).toHaveLength(1);
    expect(f.rows.find((row) => row.userId === "alice")).toMatchObject({
      source: "manual",
      listingId: "listing",
      url: "https://example.com/jobs/1",
      submission: null,
    });
    expect(f.rows.find((row) => row.userId === "bob")?.submission).toEqual({
      confirmation: "retained",
    });
  });
  it("keeps confirmed agent applications and subsequent statuses unchanged", async () => {
    const existing = { ...confirmed(), status: "interviewing" };
    const f = fixture([existing]);
    expect(await f.service.markApplied("alice", "example", "session_user")).toMatchObject({
      isApplied: true,
      canUndoApplied: false,
      applicationId: existing.id,
    });
    expect(f.writes).toHaveLength(0);
    expect((await f.service.undoApplied("alice", "example", "session_user")).isApplied).toBe(true);
    expect(f.rows[0]).toEqual(existing);
  });
  it("undoes only the requesting user's unsubmitted manual mark", async () => {
    const f = fixture([confirmed("bob")]);
    await f.service.markApplied("alice", "example", "session_user");
    expect(await f.service.undoApplied("alice", "example", "session_user")).toMatchObject({
      isApplied: false,
      applicationId: null,
      canUndoApplied: false,
    });
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]?.userId).toBe("bob");
    expect(f.writes.at(-1)).toMatchObject({
      where: {
        userId: "alice",
        listingId: "listing",
        source: "manual",
        status: "applied",
        campaignId: null,
        submissionAttempt: { is: null },
      },
    });
  });
  it("preserves a preexisting confirmed record found during the idempotent upsert", async () => {
    const existing = { ...confirmed(), listingId: "old-listing" };
    const f = fixture([existing]);
    const result = await f.service.markApplied("alice", "example", "session_user");
    expect(result).toMatchObject({ applicationId: existing.id, canUndoApplied: false });
    expect(f.rows[0]).toMatchObject({
      source: "apply",
      status: "applied",
      submission: { confirmation: "retained" },
    });
    expect(f.writes[0]).toMatchObject({ update: { listingId: "listing" } });
  });

  it("recovers a unique-constraint race without replacing the winning receipt", async () => {
    const f = fixture([{ ...confirmed(), listingId: "not-linked-yet" }]);
    const upsert = spyOn(f.db.application, "upsert").mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );
    try {
      const result = await f.service.markApplied("alice", "example", "session_user");
      expect(result).toMatchObject({ isApplied: true, canUndoApplied: false });
      expect(f.rows).toHaveLength(1);
      expect(f.rows[0]?.submission).toEqual({ confirmation: "retained" });
    } finally {
      upsert.mockRestore();
    }
  });
});
