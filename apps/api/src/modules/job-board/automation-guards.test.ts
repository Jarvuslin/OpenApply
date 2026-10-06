import type { CryptoService } from "@/common/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { CampaignService } from "@/modules/campaign/campaign.service";
import { assertNotDuplicateApply } from "@/modules/campaign/jobs/apply-guard";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { CredentialService } from "@/modules/credential/credential.service";
import type { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import { JobBoardService } from "./job-board.service";
import { describe, expect, it } from "bun:test";

const db = {} as PrismaClient;
describe("discovery-only API refusals", () => {
  const campaigns = new CampaignService(db);
  const creds = new CredentialService(db, {} as CryptoService);
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
  it("refuses links and domain credentials", async () => {
    await expect(new JobBoardService(db).create("u", { domain: "wellfound.com" })).rejects.toThrow(
      "Wellfound",
    );
    await expect(
      creds.create("u", { scope: "indeed.com", email: "u@example.com", password: "test" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(creds.update("u", "id", { scope: "glassdoor.co.uk" })).rejects.toMatchObject({
      status: 422,
    });
  });
  it("refuses approval, applying, retries and worker claims", async () => {
    for (const status of ["pending", "approved", "failed"]) {
      const row = { status, url: "https://linkedin.com/jobs/1", campaign: { source: "apply" } };
      const fake = { job: { findFirst: async () => row } } as unknown as PrismaClient;
      const jobs = new CampaignJobService(fake, {} as JobListingPublisher);
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
