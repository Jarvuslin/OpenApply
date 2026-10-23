import { buildAgenda } from "./build";
import {
  base,
  boardHealth,
  bootstrap,
  cfg,
  dueQuery,
  job,
  pausedCampaign,
  question,
  queueDrain,
  reply,
  scorePending,
  strategyReview,
} from "./builders";
import { describe, expect, it } from "bun:test";

const DEFAULT_CONFIG = cfg({});
const kinds = (agenda: ReturnType<typeof buildAgenda>) => agenda.items.map((i) => i.kind);
const countOf = (agenda: ReturnType<typeof buildAgenda>, kind: string) =>
  agenda.items.filter((i) => i.kind === kind).length;

describe("buildAgenda ranking", () => {
  it("puts humans and failing boards above any apply, and the rest of the queue below it", () => {
    const agenda = buildAgenda(
      base({
        config: DEFAULT_CONFIG,
        answeredQuestions: [question("q1")],
        interviewReplies: [reply("em1")],
        boardHealth: [boardHealth("linkedin")],
        pausedCampaigns: [pausedCampaign("c9")],
        approvedJobs: [job("j1", 100)],

        queueDrains: [queueDrain("c8")],
        inbox: { messageIds: ["e1"], count: 1 },
      }),
    );
    expect(kinds(agenda)).toEqual([
      "question.answered",
      "interview.reply",
      "board.health",
      "campaign.reviewPaused",
      "job.apply",

      "queue.drain",
      "inbox.review",
    ]);
  });

  it("ranks the supporting kinds once nothing is left to apply to", () => {
    const agenda = buildAgenda(
      base({
        scorePending: [scorePending("c1")],
        dueQueries: [dueQuery("golang")],
      }),
    );
    expect(kinds(agenda)).toEqual(["campaign.scorePending", "search.discover"]);
  });

  it("ranks applies by matchScore and keeps the top 10, with a paused review still on top", () => {
    const jobs = Array.from({ length: 15 }, (_, i) => job(`j${i}`, 80 + i));
    const agenda = buildAgenda(
      base({ config: DEFAULT_CONFIG, approvedJobs: jobs, pausedCampaigns: [pausedCampaign("c9")] }),
    );
    expect(agenda.items).toHaveLength(10);
    expect(agenda.items.map((i) => i.subjectId).slice(0, 3)).toEqual(["c9", "c1:j14", "c1:j13"]);
  });

  it("caps long titles", () => {
    const long = { ...question("q1"), prompt: "x".repeat(500) };
    const agenda = buildAgenda(base({ answeredQuestions: [long] }));
    expect(agenda.items[0].title).toHaveLength(200);
  });
});

describe("buildAgenda gating", () => {
  it("stops applying once the daily cap is spent, but still reviews paused campaigns", () => {
    const agenda = buildAgenda(
      base({
        config: cfg({ dailyApplyCap: 3 }),
        appliedToday: 3,
        approvedJobs: [job("j1", 90)],
        pausedCampaigns: [pausedCampaign("c9")],
      }),
    );
    expect(kinds(agenda)).toEqual(["campaign.reviewPaused"]);
    expect(agenda.budget).toMatchObject({ dailyApplyCap: 3, appliedToday: 3, capReached: true });
  });

  it("holds scoring and discovery back while approved jobs remain", () => {
    const agenda = buildAgenda(
      base({
        approvedJobs: [job("j1", 80)],
        scorePending: [scorePending("c1")],
        dueQueries: [dueQuery("golang")],
      }),
    );
    expect(kinds(agenda)).toEqual(["job.apply"]);
  });

  it("holds bootstrap and campaign reviews back until the pipeline is quiet", () => {
    const quietWork = {
      bootstrap,
      strategyReviews: [strategyReview("c1")],
      rescanSkipped: [{ campaignId: "c1", skippedCount: 9 }],
      retryFailed: [{ campaignId: "c1", failedCount: 4 }],
    };
    expect(kinds(buildAgenda(base(quietWork)))).toEqual([
      "strategy.bootstrap",
      "campaign.strategyReview",
      "job.rescanSkipped",
      "job.retryFailed",
    ]);

    const busyWith = [
      { approvedJobs: [job("j1", 80)] },
      { queueDrains: [queueDrain("c9")] },
      { dueQueries: [dueQuery("golang")] },
      { scorePending: [scorePending("c2")] },
    ];
    for (const busy of busyWith) {
      const agenda = buildAgenda(base({ ...quietWork, ...busy }));
      expect(kinds(agenda)).not.toContain("strategy.bootstrap");
      expect(kinds(agenda)).not.toContain("campaign.strategyReview");
    }
  });

  it("holds each focused kind to its per-agenda cap", () => {
    const agenda = buildAgenda(
      base({
        boardHealth: [boardHealth("linkedin"), boardHealth("indeed")],
        pausedCampaigns: [pausedCampaign("c1"), pausedCampaign("c2")],
        interviewReplies: [reply("e1"), reply("e2"), reply("e3")],
      }),
    );
    expect(countOf(agenda, "board.health")).toBe(1);
    expect(countOf(agenda, "campaign.reviewPaused")).toBe(1);
    expect(countOf(agenda, "interview.reply")).toBe(2);

    const quiet = buildAgenda(
      base({
        strategyReviews: [strategyReview("c1"), strategyReview("c2")],
      }),
    );

    expect(countOf(quiet, "campaign.strategyReview")).toBe(1);
  });
});

describe("buildAgenda discovery", () => {
  it("rotates across the configured boards, or keeps the search's own board without any", () => {
    const boardAt = (cycleCount: number, boards: string[]) =>
      buildAgenda(
        base({
          config: cfg({ boards }),
          cycleCount,
          dueQueries: [dueQuery("golang", "wellfound")],
        }),
      ).items[0].payload;

    const rotation = ["hiring.cafe", "linkedin.com", "indeed.com"];
    expect([0, 1, 2, 3].map((cycle) => boardAt(cycle, rotation))).toMatchObject([
      { board: "hiring.cafe" },
      { board: "linkedin.com" },
      { board: "indeed.com" },
      { board: "hiring.cafe" },
    ]);
    expect(boardAt(0, [])).toMatchObject({ board: "wellfound", maxPages: 5 });
  });
});

describe("buildAgenda empty reason and sleep", () => {
  it("names why an empty agenda is empty", () => {
    expect(buildAgenda(base({ approvedJobs: [job("j1", 80)] })).emptyReason).toBeNull();
    expect(buildAgenda(base({ config: cfg({ dailyApplyCap: 0 }) })).emptyReason).toBe("capReached");
    expect(buildAgenda(base({ awaitingSetup: true })).emptyReason).toBe("awaitingSetup");
    expect(buildAgenda(base({ awaitingSetup: false })).emptyReason).toBe("clear");
  });

  it("sleeps briefly with work queued, and otherwise until the check interval", () => {
    expect(buildAgenda(base({ approvedJobs: [job("j1", 80)] })).sleepSeconds).toBe(15);

    const idle = buildAgenda(base({ config: cfg({ checkIntervalMinutes: 30 }) }));
    expect(idle.sleepSeconds).toBe(1800);
    expect(idle.nextWakeAt).toEqual(new Date(idle.generatedAt.getTime() + 1800 * 1000));
  });

  it("wakes for the next search due, but never sooner than the floor", () => {
    const sleepUntil = (minutes: number) =>
      buildAgenda(
        base({
          config: cfg({ checkIntervalMinutes: 30 }),
          nextSearchRunAt: new Date(base().now.getTime() + minutes * 60 * 1000),
        }),
      ).sleepSeconds;
    expect(sleepUntil(5)).toBe(300);
    expect(sleepUntil(-1)).toBe(30);
  });
});

it("ignores retired instruction fields instead of emitting removed actions", () => {
  const config = cfg({
    dailyApplyCap: 10,
    ...JSON.parse('{"networking":{"email":"auto"},"platforms":["hn"]}'),
  });
  const agenda = buildAgenda(
    base({ config, approvedJobs: [job("j1", 90)], interviewReplies: [reply("em1")] }),
  );
  expect(kinds(agenda)).toEqual(["interview.reply", "job.apply"]);
});
