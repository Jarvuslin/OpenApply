import type { Prisma, SubmissionAttempt } from "@/generated/prisma/client";
import { assertNoSubmissionConflict, submissionConflict } from "./submission-guard";
import { describe, expect, it } from "bun:test";

function attempt(over: Partial<SubmissionAttempt> = {}): SubmissionAttempt {
  return {
    id: "a1",
    userId: "u1",
    jobId: "j1",
    originalUrl: "https://example.test/jobs/1",
    canonicalUrl: "https://example.test/jobs/1",
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
    ...over,
  };
}

function db(rows: SubmissionAttempt[]) {
  return {
    submissionAttempt: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; OR: { canonicalUrl?: string; jobId?: string }[] };
      }) =>
        rows.find(
          (row) =>
            row.userId === where.userId &&
            where.OR.some(
              (key) => key.canonicalUrl === row.canonicalUrl || key.jobId === row.jobId,
            ),
        ) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows.filter((row) => row.userId === where.userId && row.legacyOutcomeUnknown),
    },
  } as unknown as Pick<Prisma.TransactionClient, "submissionAttempt">;
}

const posting = { id: "j1", url: "https://example.test/jobs/1" };

describe("submission recovery guards", () => {
  it("allows the same job to resume only its unstarted preparation", async () => {
    await expect(
      assertNoSubmissionConflict(db([attempt()]), "u1", posting),
    ).resolves.toBeUndefined();
    await expect(assertNoSubmissionConflict(db([]), "u1", posting)).resolves.toBeUndefined();
  });

  it("does not share a prepared reservation with another campaign job", async () => {
    await expect(
      assertNoSubmissionConflict(db([attempt()]), "u1", { ...posting, id: "another-job" }),
    ).rejects.toThrow("Another job already holds");
  });

  it("blocks a begun submission even when no receipt or result exists", async () => {
    await expect(
      assertNoSubmissionConflict(db([attempt({ startedAt: new Date() })]), "u1", posting),
    ).rejects.toThrow("do not submit again");
  });

  it("blocks canonical aliases across campaigns and after original job deletion", async () => {
    const row = attempt({ jobId: null, startedAt: new Date() });
    await expect(
      assertNoSubmissionConflict(db([row]), "u1", {
        id: "replacement",
        url: "http://www.example.test/jobs/1/?utm_source=repost",
      }),
    ).rejects.toThrow("do not submit again");
  });

  it("protects a raw legacy URL without inventing checkpoint or attempt time", async () => {
    const row = attempt({
      jobId: null,
      canonicalUrl: null,
      originalUrl: "http://www.example.test/jobs/1/?utm_source=legacy",
      legacyOutcomeUnknown: true,
    });
    expect(row.startedAt).toBeNull();
    expect(row.checkpoint).toBeNull();
    await expect(assertNoSubmissionConflict(db([row]), "u1", posting)).rejects.toThrow(
      "requires recovery",
    );
  });

  it("directs saved receipts to record recovery and never authorizes a second submit", async () => {
    const row = attempt({ receiptStoredAt: new Date() });
    await expect(assertNoSubmissionConflict(db([row]), "u1", posting)).rejects.toThrow(
      "Recover the application record",
    );
    expect(submissionConflict(attempt({ recordedAt: new Date() }), "j1")).toBe(true);
  });

  it("keeps another user's reservation private", async () => {
    await expect(
      assertNoSubmissionConflict(
        db([attempt({ userId: "other", startedAt: new Date() })]),
        "u1",
        posting,
      ),
    ).resolves.toBeUndefined();
  });
});
