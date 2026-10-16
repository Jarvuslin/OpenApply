import type {} from "@/generated/prisma/client";
import { jobSummary, summarizeCampaigns } from "./campaign.summary";
import { describe, expect, it } from "bun:test";

describe("summarizeCampaigns", () => {
  it("aggregates each campaign from job rows only", async () => {
    const rows = [{ campaignId: "c1", status: "applied", _count: { _all: 2, matchScore: 2 } }];
    const client = { job: { groupBy: async () => rows } } as unknown as Parameters<
      typeof summarizeCampaigns
    >[0];
    const result = await summarizeCampaigns(client, [
      { campaignId: "c1", source: "apply" },
      { campaignId: "c2", source: "search" },
    ]);
    expect(result.map((c) => c.summary.applied)).toEqual([2, 0]);
  });

  it("does not qualify a newly created five-job queue", async () => {
    const client = {
      job: {
        groupBy: async () => [
          { campaignId: "trial", status: "queued", _count: { _all: 5, matchScore: 0 } },
        ],
      },
    } as unknown as Parameters<typeof summarizeCampaigns>[0];

    const [campaign] = await summarizeCampaigns(client, [{ campaignId: "trial", source: "apply" }]);

    expect(campaign.summary).toMatchObject({ totalFound: 5, qualified: 0, scored: 0, applied: 0 });
  });
});

describe("jobSummary", () => {
  it("keeps scored jobs and status roll-ups consistent", () => {
    const summary = jobSummary(
      ["pending", "approved", "applying", "applied", "failed", "skipped", "needs_user"].map(
        (status) => ({ status, count: 2, scored: 2 }),
      ),
    );
    const c = summary.byStatus;

    expect(summary.totalFound).toBe(14);
    expect(summary.qualified).toBe(c.approved + c.applying + c.applied);
    expect(summary.applied).toBe(c.applied);
    expect(summary.failed).toBe(c.failed);
    expect(summary.skipped).toBe(c.skipped);
    expect(summary.remaining).toBe(c.approved + c.applying + c.needs_user);
    expect(summary.scored).toBe(14);
  });

  it("requires promotion and a score before counting a candidate as qualified", () => {
    const summary = jobSummary([
      { status: "queued", count: 2, scored: 1 },
      { status: "pending", count: 4, scored: 1 },
      { status: "approved", count: 3, scored: 2 },
      { status: "needs_user", count: 2, scored: 0 },
      { status: "skipped", count: 4, scored: 4 },
    ]);

    expect(summary).toMatchObject({ totalFound: 15, qualified: 2, scored: 8, skipped: 4 });
  });

  it("retains historical applied jobs that predate fit scoring", () => {
    const summary = jobSummary([
      { status: "applied", count: 3, scored: 1 },
      { status: "pending", count: 2 },
    ]);

    expect(summary).toMatchObject({ qualified: 3, applied: 3, scored: 1 });
  });
});
