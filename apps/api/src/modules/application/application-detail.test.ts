import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationService } from "./application.service";
import { describe, expect, it } from "bun:test";

interface Posting {
  campaignId: string;
  userId: string;
  url: string;
  applicationId: string | null;
  description: string;
  salary: string;
  type: string;
}

function fixture(postings: Posting[], campaignId: string | null = "campaign") {
  const application = {
    id: "application",
    userId: "owner",
    campaignId,
    url: "https://employer.example/job/1",
    submission: null,
  };
  const db = {
    application: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === application.id && where.userId === application.userId ? application : null,
    },
    job: {
      findFirst: async ({
        where,
      }: {
        where: {
          campaignId: string;
          campaign: { userId: string };
          OR: Array<{
            url?: string;
            submissionAttempt?: { is: { applicationId: string; userId: string } };
          }>;
        };
      }) => {
        const found = postings.find(
          (job) =>
            job.campaignId === where.campaignId &&
            job.userId === where.campaign.userId &&
            where.OR.some(
              (match) =>
                match.url === job.url ||
                (match.submissionAttempt?.is.applicationId === job.applicationId &&
                  match.submissionAttempt.is.userId === job.userId),
            ),
        );
        return found
          ? { description: found.description, salary: found.salary, type: found.type }
          : null;
      },
    },
  } as unknown as PrismaClient;
  return new ApplicationService(db);
}

const posting: Posting = {
  campaignId: "campaign",
  userId: "owner",
  url: "https://employer.example/job/1/?utm_source=linkedin",
  applicationId: "application",
  description: "The complete original posting",
  salary: "$80,000",
  type: "Full time",
};

describe("ApplicationService.get posting details", () => {
  it("uses the receipt relationship when the application URL was canonicalized", async () => {
    const detail = await fixture([posting]).get("owner", "application");
    expect(detail.job).toEqual({
      description: posting.description,
      salary: posting.salary,
      type: posting.type,
    });
  });

  it("still reads exact-URL history without a submission attempt", async () => {
    const detail = await fixture([
      { ...posting, url: "https://employer.example/job/1", applicationId: null },
    ]).get("owner", "application");
    expect(detail.job?.description).toBe(posting.description);
  });

  it("does not select another user's or another campaign's posting", async () => {
    const detail = await fixture([
      { ...posting, userId: "other" },
      { ...posting, campaignId: "other-campaign" },
    ]).get("owner", "application");
    expect(detail.job).toBeNull();
  });

  it("does not attach a campaign posting to an application without a campaign", async () => {
    const detail = await fixture([posting], null).get("owner", "application");
    expect(detail.job).toBeNull();
  });
});
