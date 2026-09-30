import { HOUR_MS } from "@/common/date/buckets";
import { approvedJob, pilotSearchRow, service } from "./fakes";
import { describe, expect, it } from "bun:test";

const dueRow = (over: Record<string, unknown> = {}) =>
  pilotSearchRow({ nextRunAt: new Date(Date.now() - HOUR_MS), ...over });
const futureRow = (over: Record<string, unknown> = {}) =>
  pilotSearchRow({ nextRunAt: new Date(Date.now() + HOUR_MS), ...over });

const discoverOf = (agenda: { items: { kind: string; subjectId: string; payload: unknown }[] }) =>
  agenda.items.find((i) => i.kind === "search.discover");

describe("AgendaService search.discover", () => {
  it("offers a due search, keyed by its id", async () => {
    const agenda = await service({ pilotSearches: [dueRow({ id: "s-react" })] }).refresh("p1");
    const item = discoverOf(agenda);
    expect(item?.subjectId).toBe("s-react");
    expect(item?.payload).toMatchObject({ searchId: "s-react", query: "react", newJobsTarget: 10 });
  });

  it("waits on a search that is not due and ran recently", async () => {
    const agenda = await service({
      pilotSearches: [futureRow({ lastRunAt: new Date() })],
    }).refresh("p1");
    expect(discoverOf(agenda)).toBeUndefined();
  });

  it("runs an idle search early while the apply cap has room, and not once it is spent", async () => {
    const hungry = await service({
      pilotSearches: [futureRow({ id: "s-hungry", lastRunAt: null })],
    }).refresh("p1");
    expect(discoverOf(hungry)?.subjectId).toBe("s-hungry");

    const spent = await service({
      instructionsConfig: { dailyApplyCap: 5 },
      appliedToday: 5,
      pilotSearches: [futureRow({ lastRunAt: null })],
    }).refresh("p1");
    expect(discoverOf(spent)).toBeUndefined();
  });

  it("holds a search back while its last run is still open", async () => {
    const agenda = await service({
      pilotSearches: [dueRow({ id: "s-react" })],
      searchClaims: [{ subjectId: "s-react", grantedAt: new Date(), releasedAt: null }],
    }).refresh("p1");
    expect(discoverOf(agenda)).toBeUndefined();
  });

  it("reuses the newest campaign the search spawned, whatever its query is now", async () => {
    const agenda = await service({
      pilotSearches: [dueRow({ id: "s1", query: "senior react" })],
      dueSearchCampaigns: [
        { campaignId: "c-old", pilotSearchId: "s1" },
        { campaignId: "c-new", pilotSearchId: "s1" },
      ],
    }).refresh("p1");
    expect(discoverOf(agenda)?.payload).toMatchObject({ campaignId: "c-new" });

    const fresh = await service({ pilotSearches: [dueRow()] }).refresh("p1");
    expect(discoverOf(fresh)?.payload).toMatchObject({ campaignId: undefined });
  });
});

describe("AgendaService strategy.bootstrap", () => {
  const goals = "Senior TS roles, remote";
  const bootstrapOf = (agenda: { items: { kind: string; payload: unknown }[] }) =>
    agenda.items.find((i) => i.kind === "strategy.bootstrap");

  it("derives searches from the goals when none exist", async () => {
    const agenda = await service({
      instructionsConfig: { minScore: 70 },
      instructionsGoals: `  ${goals} `,
    }).refresh("p1");
    expect(bootstrapOf(agenda)?.payload).toEqual({ goals, minScore: 70 });
  });

  it("stays out when goals are blank, a search exists, a try is recent, or work is queued", async () => {
    const blank = await service({ instructionsGoals: "   " }).refresh("p1");
    expect(bootstrapOf(blank)).toBeUndefined();
    expect(blank.emptyReason).toBe("awaitingSetup");

    const cases = [
      { pilotSearches: [futureRow({ lastRunAt: new Date() })] },
      { bootstrapClaim: { releasedAt: null } },
      { approvedJobs: [approvedJob()] },
    ];
    for (const over of cases) {
      const agenda = await service({ instructionsGoals: goals, ...over }).refresh("p1");
      expect(bootstrapOf(agenda)).toBeUndefined();
    }
  });
});
