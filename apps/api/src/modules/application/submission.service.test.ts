import type { PrismaClient } from "@/generated/prisma/client";
import { SubmissionService } from "./submission.service";
import { describe, expect, it } from "bun:test";

describe("SubmissionService ownership", () => {
  it("checks job ownership before storing PDF bytes", async () => {
    let filter: unknown;
    const db = {
      job: {
        findFirst: async ({ where }: { where: unknown }) => {
          filter = where;
          return null;
        },
      },
    } as unknown as PrismaClient;
    await expect(
      new SubmissionService(db).uploadResume(
        "owner",
        "campaign",
        "job",
        new File(["%PDF-1"], "resume.pdf"),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(filter).toEqual({ campaignId: "campaign", key: "job", campaign: { userId: "owner" } });
  });

  it("rejects uploads unless the owned job is applying", async () => {
    for (const status of ["queued", "approved", "needs_user", "applied", "failed", "skipped"]) {
      const db = {
        job: { findFirst: async () => ({ id: "job", status }) },
      } as unknown as PrismaClient;
      await expect(
        new SubmissionService(db).uploadResume(
          "owner",
          "campaign",
          "job",
          new File(["%PDF-1"], "resume.pdf"),
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
  });

  it("checks application ownership before reading retained bytes", async () => {
    let filter: unknown;
    const db = {
      application: {
        findFirst: async ({ where }: { where: unknown }) => {
          filter = where;
          return null;
        },
      },
    } as unknown as PrismaClient;
    await expect(new SubmissionService(db).resumePdf("owner", "application")).rejects.toMatchObject(
      { status: 404 },
    );
    expect(filter).toEqual({ id: "application", userId: "owner" });
  });

  it("does not substitute the current resume for missing historical evidence", async () => {
    const db = {
      application: { findFirst: async () => ({ submission: null }) },
    } as unknown as PrismaClient;
    await expect(new SubmissionService(db).resumePdf("owner", "historical")).rejects.toMatchObject({
      status: 404,
    });
  });
});
