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
});

describe("jobSummary", () => {
  // The roll-ups ship on the wire for the installed agent skills, but they are a projection of
  // byStatus; this pins that they cannot drift apart for any mix of statuses.
  it("keeps every roll-up consistent with byStatus", () => {
    const summary = jobSummary(
      ["pending", "approved", "applying", "applied", "failed", "skipped", "needs_user"].map(
        (status) => ({ status, count: 2 }),
      ),
    );
    const c = summary.byStatus;

    expect(summary.totalFound).toBe(14);
    expect(summary.qualified).toBe(14 - c.skipped);
    expect(summary.applied).toBe(c.applied);
    expect(summary.failed).toBe(c.failed);
    expect(summary.skipped).toBe(c.skipped);
    expect(summary.remaining).toBe(c.approved + c.applying + c.needs_user);
  });
});
