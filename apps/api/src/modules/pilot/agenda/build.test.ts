import { buildAgenda } from "./build";
import {
  base,
  boardHealth,
  bootstrap,
  cfg,
  contact,
  dueQuery,
  followup,
  hotJob,
  job,
  pausedCampaign,
  prep,
  question,
  queueDrain,
  reply,
  scorePending,
  send,
  strategyReview,
} from "./builders";
import { describe, expect, it } from "bun:test";

const NETWORKING_OFF = cfg({ networking: { email: "off", linkedIn: "off" } });
const kinds = (agenda: ReturnType<typeof buildAgenda>) => agenda.items.map((i) => i.kind);
const countOf = (agenda: ReturnType<typeof buildAgenda>, kind: string) =>
  agenda.items.filter((i) => i.kind === kind).length;

describe("buildAgenda ranking", () => {
  it("puts humans and failing boards above any apply, and the rest of the queue below it", () => {
    const agenda = buildAgenda(
      base({
        config: NETWORKING_OFF,
        answeredQuestions: [question("q1")],
        interviewReplies: [reply("em1")],
        boardHealth: [boardHealth("linkedin")],
        pausedCampaigns: [pausedCampaign("c9")],
        approvedJobs: [job("j1", 100)],
        interviewPreps: [prep("app1")],
        queueDrains: [queueDrain("c8")],
        inbox: { messageIds: ["e1"], count: 1 },
        upworkSync: { lastSyncedAt: null, unreadCount: 0 },
      }),
    );
    expect(kinds(agenda)).toEqual([
      "question.answered",
      "interview.reply",
      "board.health",
      "campaign.reviewPaused",
      "job.apply",
      "interview.prep",
      "queue.drain",
      "inbox.review",
      "upwork.syncInbox",
    ]);
  });

  it("ranks the supporting kinds once nothing is left to apply to", () => {
    const agenda = buildAgenda(
      base({
        approvedNetworking: [send("m1")],
        approvedPromotions: [
          { promotionId: "p1", platform: "hn", target: null, title: null, body: "b" },
        ],
        warmIntroCandidates: [hotJob("j1", 90)],
        scorePending: [scorePending("c1")],
        dueQueries: [dueQuery("golang")],
        followups: [followup("f1")],
        duePlatforms: [{ platform: "reddit" }],
      }),
    );
    expect(kinds(agenda)).toEqual([
      "networking.send",
      "promo.post",
      "networking.warmIntro",
      "campaign.scorePending",
      "search.discover",
      "networking.followup",
      "promo.compose",
    ]);
  });

  it("ranks applies by matchScore and keeps the top 10, with a paused review still on top", () => {
    const jobs = Array.from({ length: 15 }, (_, i) => job(`j${i}`, 80 + i));
    const agenda = buildAgenda(
      base({ config: NETWORKING_OFF, approvedJobs: jobs, pausedCampaigns: [pausedCampaign("c9")] }),
    );
    expect(agenda.items).toHaveLength(10);
    expect(agenda.items.map((i) => i.subjectId).slice(0, 3)).toEqual(["c9", "j14", "j13"]);
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
        config: cfg({ dailyApplyCap: 3, networking: { email: "off", linkedIn: "off" } }),
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
        interviewPreps: [prep("a1"), prep("a2")],
      }),
    );
    expect(countOf(agenda, "board.health")).toBe(1);
    expect(countOf(agenda, "campaign.reviewPaused")).toBe(1);
    expect(countOf(agenda, "interview.reply")).toBe(2);
    expect(countOf(agenda, "interview.prep")).toBe(1);

    const quiet = buildAgenda(
      base({
        warmIntroCandidates: [hotJob("j1", 90), hotJob("j2", 88)],
        followups: [followup("f1"), followup("f2"), followup("f3")],
        duePlatforms: [{ platform: "hn" }, { platform: "reddit" }],
        strategyReviews: [strategyReview("c1"), strategyReview("c2")],
      }),
    );
    expect(countOf(quiet, "networking.warmIntro")).toBe(1);
    expect(countOf(quiet, "networking.followup")).toBe(2);
    expect(countOf(quiet, "promo.compose")).toBe(1);
    expect(countOf(quiet, "campaign.strategyReview")).toBe(1);
  });
});

describe("buildAgenda networking", () => {
  it("spends the networking cap on sends first, and gives followups what is left", () => {
    const withRoom = buildAgenda(
      base({
        config: cfg({ networking: { dailyCap: 3 } }),
        networkingSentToday: 1,
        approvedNetworking: [send("m1")],
        followups: [followup("f1"), followup("f2")],
      }),
    );
    expect(countOf(withRoom, "networking.send")).toBe(1);
    expect(countOf(withRoom, "networking.followup")).toBe(1);

    const spent = buildAgenda(
      base({
        config: cfg({ networking: { dailyCap: 2 } }),
        networkingSentToday: 2,
        approvedNetworking: [send("m1")],
        followups: [followup("f1")],
        warmIntroCandidates: [hotJob("j1", 90)],
      }),
    );
    expect(spent.items).toEqual([]);
  });

  it("drops every networking kind when both channels are off, but still triages the inbox", () => {
    const agenda = buildAgenda(
      base({
        config: NETWORKING_OFF,
        warmIntroCandidates: [hotJob("j1", 90)],
        approvedNetworking: [send("m1")],
        followups: [followup("f1")],
        inbox: { messageIds: ["e1"], count: 1 },
      }),
    );
    expect(kinds(agenda)).toEqual(["inbox.review"]);
  });

  it("sends email-only work by email, and warm intros by the first channel that is on", () => {
    const bothOn = buildAgenda(
      base({
        config: cfg({ networking: { email: "auto", linkedIn: "review" } }),
        warmIntroCandidates: [hotJob("j1", 90)],
        followups: [followup("f1")],
      }),
    );
    const intro = bothOn.items.find((i) => i.kind === "networking.warmIntro");
    const followupItem = bothOn.items.find((i) => i.kind === "networking.followup");
    expect(intro?.payload).toMatchObject({ channel: "email", autonomy: "auto" });
    expect(followupItem?.payload).toMatchObject({ channel: "email", autonomy: "auto" });

    const linkedInOnly = buildAgenda(
      base({
        config: cfg({ networking: { email: "off", linkedIn: "review" } }),
        warmIntroCandidates: [hotJob("j1", 90)],
        approvedNetworking: [send("m1")],
        followups: [followup("f1")],
      }),
    );
    expect(kinds(linkedInOnly)).toEqual(["networking.warmIntro"]);
    expect(linkedInOnly.items[0].payload).toMatchObject({
      channel: "linkedin",
      autonomy: "review",
    });
  });

  it("carries known insiders on both the apply and the intro, and intros with none", () => {
    const insider = contact("w1");
    const known = hotJob("j1", 90, [insider]);
    const agenda = buildAgenda(base({ approvedJobs: [known], warmIntroCandidates: [known] }));
    const apply = agenda.items.find((i) => i.kind === "job.apply");
    const intro = agenda.items.find((i) => i.kind === "networking.warmIntro");
    expect(apply?.payload).toMatchObject({ warmContacts: [insider] });
    expect(intro?.payload).toMatchObject({ contacts: [insider] });

    const unknown = buildAgenda(base({ warmIntroCandidates: [hotJob("j2", 90)] }));
    expect(unknown.items[0].payload).toMatchObject({ contacts: [] });
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
