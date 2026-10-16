import { applyQueueFixture as fixture } from "./apply-queue.fakes";
import { describe, expect, it } from "bun:test";

describe("standing apply queue intake fences", () => {
  it.each([
    { decision: "pending" as const, identity: "canonicalUrl" as const },
    { decision: "skip" as const, identity: "canonicalUrl" as const },
    { decision: "pending" as const, identity: "originalUrl" as const },
    { decision: "skip" as const, identity: "originalUrl" as const },
  ])("rejects $decision intake through its $identity", async ({ decision, identity }) => {
    const f = fixture();
    f.intakes.push({
      id: crypto.randomUUID(),
      userId: "alice",
      canonicalUrl: "https://ats.example.test/job/elsewhere",
      originalUrl: "https://employer.example.test/job/elsewhere",
      decision,
      [identity]: "https://jobs.ashbyhq.com/acme/1",
    });
    await expect(f.service.enqueue("alice", ["one"])).rejects.toThrow(
      "choose Apply now or Add to queue first",
    );
    expect(f.workItems).toHaveLength(0);
    expect(f.locks()).toBe(1);
  });
  it.each(["queue", "apply_now"] as const)(
    "preserves a human %s intake decision at admission",
    async (decision) => {
      const f = fixture();
      f.intakes.push({
        id: crypto.randomUUID(),
        userId: "alice",
        canonicalUrl: "https://jobs.ashbyhq.com/acme/1",
        originalUrl: "https://employer.example.test/job/one",
        decision,
      });
      expect((await f.service.enqueue("alice", ["one"])).queued).toEqual(["one"]);
      expect(f.workItems).toHaveLength(1);
    },
  );
  it("does not apply another owner's pending or skipped intake to this account", async () => {
    const f = fixture();
    for (const decision of ["pending", "skip"] as const)
      f.intakes.push({
        id: crypto.randomUUID(),
        userId: "bob",
        canonicalUrl: "https://jobs.ashbyhq.com/acme/1",
        originalUrl: "https://jobs.ashbyhq.com/acme/2",
        decision,
      });
    expect((await f.service.enqueue("alice", ["one", "two"])).queued).toEqual(["one", "two"]);
    expect(f.workItems).toHaveLength(2);
  });
});
