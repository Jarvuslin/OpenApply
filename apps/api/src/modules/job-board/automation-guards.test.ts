import type { PrismaClient } from "@/generated/prisma/client";
import type { SubmissionService } from "@/modules/application/submission.service";
import { CampaignService } from "@/modules/campaign/campaign.service";
import { assertNotDuplicateApply } from "@/modules/campaign/jobs/apply-guard";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import type { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { JobBoardService } from "./job-board.service";
import { describe, expect, it } from "bun:test";

const db = {} as PrismaClient;
describe("discovery-only API refusals", () => {
  const campaigns = new CampaignService(db);
  it("refuses campaign boards and apply links before database writes", async () => {
    await expect(
      campaigns.create("u", {
        query: "Engineer",
        source: "search",
        createdBy: "user",
        config: { board: "indeed.ca" },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      campaigns.create("u", {
        query: "Engineer",
        source: "apply",
        createdBy: "user",
        config: {},
        urls: ["https://linkedin.com/jobs/1"],
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      campaigns.updateConfig("u", "c", { config: { board: "linkedin.com" } }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("refuses blocked job-board links", async () => {
    await expect(new JobBoardService(db).create("u", { domain: "wellfound.com" })).rejects.toThrow(
      "Wellfound",
    );
  });
  it("refuses approval, applying, retries and worker claims", async () => {
    for (const status of ["pending", "approved", "failed"]) {
      const row = { status, url: "https://linkedin.com/jobs/1", campaign: { source: "apply" } };
      const fake = { job: { findFirst: async () => row } } as unknown as PrismaClient;
      const jobs = new CampaignJobService(
        fake,
        {} as JobListingPublisher,
        {} as SubmissionService,
        {} as ScoringService,
      );
      if (status === "failed")
        await expect(jobs.retryJob("u", "c", "j", {})).rejects.toMatchObject({ status: 422 });
      else
        await expect(
          jobs.patchJob("u", "c", "j", { status: status === "pending" ? "approved" : "applying" }),
        ).rejects.toMatchObject({ status: 422 });
    }
    await expect(
      assertNotDuplicateApply(db, "u", {
        campaignId: "c",
        key: "j",
        url: "https://indeed.ca/job/1",
        title: "Engineer",
        company: "Acme",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
