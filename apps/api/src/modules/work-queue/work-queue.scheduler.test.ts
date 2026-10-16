import { schedulerFixture as setup, schedulerUserId as userId } from "./work-queue.scheduler.fakes";
import { describe, expect, it } from "bun:test";

describe("Pilot common queue scheduling", () => {
  it("does nothing while disabled and observes the code-only scheduler cooldown", async () => {
    const f = setup([]);
    f.pilotStates[0].running = false;
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 0 });
    expect(f.refreshes()).toBe(0);
    f.pilotStates[0].running = true;
    await f.scheduler.schedule(userId, "codex");
    await f.scheduler.schedule(userId, "codex");
    expect(f.refreshes()).toBe(1);
  });

  it("preserves provider choice and makes unsupported work visible without executing it", async () => {
    const f = setup([
      {
        id: "bootstrap",
        priority: 1,
        kind: "strategy.bootstrap",
        subjectType: "pilot",
        subjectId: userId,
        title: "Plan strategy",
        payload: { goals: "Find engineering roles", minScore: 60 },
      },
    ]);
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 1 });
    expect(f.workItems[0]).toMatchObject({
      kind: "pilot_task",
      provider: "codex",
      intent: "unavailable",
      state: "needs_user",
    });
    expect(await f.queue.claim(userId)).toBeNull();
    await expect(
      f.queue.control(userId, String(f.workItems[0].id), "resume"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("deduplicates an inbox batch but admits a distinct later batch", async () => {
    const item = {
      id: "inbox",
      priority: 1,
      kind: "inbox.review" as const,
      subjectType: "inbox" as const,
      subjectId: "inbox",
      title: "Review inbox",
      payload: { messageIds: ["one"], count: 1 },
    };
    const f = setup([item]);
    await f.scheduler.schedule(userId, "codex");
    f.workItems[0].state = "failed";
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 0 });
    item.payload.messageIds = ["two"];
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 1 });
    expect(f.workItems[0].state).toBe("failed");
  });

  it("uses persisted search cadence as the generation without retrying a failed generation", async () => {
    const searchId = crypto.randomUUID();
    const f = setup([
      {
        id: "search",
        priority: 1,
        kind: "search.discover",
        subjectType: "campaign",
        subjectId: searchId,
        title: "Search",
        payload: { searchId, query: "Engineer", minScore: 60, newJobsTarget: 10, maxPages: 2 },
      },
    ]);
    f.searches.push({ id: searchId, userId, nextRunAt: new Date(Date.now() - 60000) });
    await f.scheduler.schedule(userId, "codex");
    f.workItems[0].state = "failed";
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 0 });
    f.searches[0].nextRunAt = new Date(Date.now() - 1000);
    f.nextCycle();
    expect(await f.scheduler.schedule(userId, "codex")).toEqual({ enqueued: 1 });
    expect(f.workItems).toHaveLength(2);
  });
});
