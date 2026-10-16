import { CAMPAIGN_JOB_STATUSES, campaignSummarySchema } from "@openapply/contracts/campaign";
import { campaignProgress, campaignShortName, campaignStage } from "./campaign-progress";
import { describe, expect, it } from "bun:test";

function summary(values: {
  totalFound?: number;
  scored?: number;
  applied?: number;
  qualified?: number;
}) {
  return campaignSummarySchema.parse({
    kind: "jobs",
    byStatus: Object.fromEntries(CAMPAIGN_JOB_STATUSES.map((status) => [status, 0])),
    ...values,
  });
}

describe("campaign progress", () => {
  it("tracks reviewed jobs for search-only campaigns even when none were applied", () => {
    expect(
      campaignProgress("search", summary({ totalFound: 20, scored: 15, qualified: 4 })),
    ).toEqual({ value: 75, label: "15/20 scored" });
  });

  it("tracks applications against qualified jobs for auto-apply campaigns", () => {
    expect(
      campaignProgress("auto_apply", summary({ totalFound: 20, qualified: 8, applied: 2 })),
    ).toEqual({ value: 25, label: "2/8 applied" });
  });

  it("does not invent a job count before discovery", () => {
    expect(campaignProgress("search", summary({}))).toEqual({
      value: undefined,
      label: "Finding jobs",
    });
  });
});

describe("campaign names and stages", () => {
  it("shortens a profile job list to its first role", () => {
    expect(
      campaignShortName(
        "Profile job list: entry level AI Engineer Intern, entry level Software Engineer (Contract), entry level AI Lab Intern",
      ),
    ).toBe("AI Engineer Intern + 2 more");
    expect(campaignShortName("Frontend developer")).toBe("Frontend developer");
  });

  it("names the stage from its counts", () => {
    const base = { totalFound: 0, scored: 0, applied: 0, qualified: 0 } as never;
    expect(campaignStage("search", base)).toBe("Searching");
    expect(
      campaignStage("search", { ...(base as object), totalFound: 9, scored: 2 } as never),
    ).toBe("Scoring");
  });
});
