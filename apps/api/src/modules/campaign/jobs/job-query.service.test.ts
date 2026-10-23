import type { PrismaClient } from "@/generated/prisma/client";
import { CampaignJobQueryService } from "./job-query.service";
import { describe, expect, it } from "bun:test";

function setup() {
  const job = {
    intakeDecisionRequired: false,
    humanApprovalRequired: false,
    id: "job-1",
    campaignId: "campaign-1",
    key: "employer/job-42",
    title: "Software Engineer",
    company: "Example",
    location: "Toronto",
    salary: null,
    type: null,
    url: "https://example.test/job-42",
    board: "example",
    matchScore: null,
    matchReason: null,
    fitAssessment: null,
    status: "pending" as const,
    appliedAt: null,
    failReason: null,
    retryNotes: null,
    skipReason: null,
    description: "Build software.",
    digest: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const wheres: Record<string, unknown>[] = [];
  const db = {
    job: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        const campaign = where.campaign as { userId: string };
        if (
          where.campaignId !== job.campaignId ||
          where.key !== job.key ||
          campaign.userId !== "owner"
        )
          return null;
        return job;
      },
    },
  };
  return { job, wheres, service: new CampaignJobQueryService(db as unknown as PrismaClient) };
}

describe("CampaignJobQueryService.getJob", () => {
  it("reads an exact owned job without fetching or mutating the campaign list", async () => {
    const { job, wheres, service } = setup();
    expect(await service.getJob("owner", "campaign-1", "employer/job-42")).toEqual(job);
    expect(wheres).toEqual([
      {
        campaignId: "campaign-1",
        key: "employer/job-42",
        campaign: { userId: "owner" },
      },
    ]);
  });

  it("does not expose another user's job", async () => {
    const { service } = setup();
    await expect(
      service.getJob("other-user", "campaign-1", "employer/job-42"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("requires the key to belong to the requested campaign", async () => {
    const { service } = setup();
    await expect(
      service.getJob("owner", "other-campaign", "employer/job-42"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.getJob("owner", "campaign-1", "missing-job")).rejects.toMatchObject({
      status: 404,
    });
  });
});
