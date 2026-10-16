import { applyQueueFixture as fixture } from "./apply-queue.fakes";
import { startInput } from "./mvp.schema";
import { describe, expect, it } from "bun:test";

describe("standing apply queue", () => {
  it("requires ownership when selecting private listings and private resolved URLs", async () => {
    const { service, listingQueries } = fixture();
    await service.enqueue("alice", ["one", "unresolved"]);
    expect(listingQueries).toHaveLength(1);
    expect(listingQueries[0]).toMatchObject({
      where: { OR: [{ isPublic: true }, { personalDiscoveries: { some: { userId: "alice" } } }] },
      include: {
        sources: {
          where: {
            OR: [
              { isPublic: true },
              { listing: { personalDiscoveries: { some: { userId: "alice" } } } },
            ],
          },
        },
      },
    });
  });
  it("never queues a LinkedIn URL or unresolved personal discovery card", async () => {
    const { service, writes } = fixture();
    const result = await service.enqueue("alice", ["linkedin", "unresolved"]);
    expect(result.queued).toEqual([]);
    expect(result.skipped.map((row) => row.slug)).toEqual(["linkedin", "unresolved"]);
    expect(writes).toEqual([]);
  });
  it("queues multiple selections and skips duplicates, blocked and unresolved sources", async () => {
    const { service, writes, campaigns, locks } = fixture();
    const first = await service.enqueue("user", [
      "one",
      "one",
      "blocked",
      "unresolved",
      "old",
      "missing",
    ]);
    expect(first.queued).toEqual(["one"]);
    expect(first.jobKeys).toEqual([writes[0]!.key]);
    expect(first.skipped.map((row) => row.slug)).toEqual([
      "one",
      "blocked",
      "unresolved",
      "old",
      "missing",
    ]);
    const second = await service.enqueue("user", ["one", "two"]);
    expect(second.campaignId).toBe(first.campaignId);
    expect(second.queued).toEqual(["two"]);
    expect(second.skipped).toEqual([{ slug: "one", reason: "Already queued or applied" }]);
    expect(second.jobKeys).toEqual([writes[0]!.key, writes[1]!.key]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].config).toEqual({
      standing: true,
      resumeId: "00000000-0000-4000-8000-000000000001",
    });
    expect(writes).toHaveLength(2);
    expect(writes.every((row) => row.status === "approved" && !row.url.includes("indeed"))).toBe(
      true,
    );
    expect(locks()).toBe(2);
  });
  it("replays one request without duplicate jobs or work and rejects changed details", async () => {
    const { service, writes, workItems } = fixture();
    const key = crypto.randomUUID();
    const first = await service.enqueue("user", ["one"], key, "codex");
    expect(await service.enqueue("user", ["one"], key, "codex")).toEqual(first);
    expect(writes).toHaveLength(1);
    expect(workItems).toHaveLength(1);
    expect(workItems[0].provider).toBe("codex");
    expect(first.workItemIds).toEqual([workItems[0].id]);
    await expect(service.enqueue("user", ["two"], key, "codex")).rejects.toThrow(
      "different details",
    );
    await expect(service.enqueue("user", ["one"], key, "claude")).rejects.toThrow(
      "different details",
    );
    expect(writes).toHaveLength(1);
  });
  it("validates the batch bounds", () => {
    expect(startInput.safeParse({ slugs: [] }).success).toBe(false);
    expect(startInput.safeParse({ slugs: Array(101).fill("x") }).success).toBe(false);
    expect(startInput.safeParse({ slugs: ["one", "two"] }).success).toBe(true);
  });
  it("returns only explicitly selected keys when the standing queue contains other jobs", async () => {
    const { service, writes } = fixture();
    await service.enqueue("user", ["one", "two"]);
    const retry = await service.enqueue("user", ["two"]);
    expect(retry.jobKeys).toEqual([writes[1]!.key]);
    writes[1]!.status = "applied";
    const complete = await service.enqueue("user", ["two"]);
    expect(complete.jobKeys).toEqual([]);
  });
  it.each(["approved", "applying", "needs_user"])(
    "returns the selected existing %s job for inspection without restarting it",
    async (status) => {
      const { service, writes } = fixture();
      await service.enqueue("user", ["one", "two"]);
      writes[1]!.status = status;
      const resumed = await service.enqueue("user", ["two", "two"]);
      expect(resumed.jobKeys).toEqual([writes[1]!.key]);
      expect(resumed.queued).toEqual([]);
      expect(writes).toHaveLength(2);
      expect(writes[1]!.status).toBe(status);
    },
  );
  it.each(["queued", "pending"])(
    "leaves selected %s jobs for preparation instead of returning a runnable key",
    async (status) => {
      const { service, writes } = fixture();
      await service.enqueue("user", ["one", "two"]);
      writes[1]!.status = status;
      const resumed = await service.enqueue("user", ["two"]);
      expect(resumed.jobKeys).toEqual([]);
      expect(resumed.queued).toEqual([]);
      expect(resumed.skipped).toEqual([
        {
          slug: "two",
          reason: "Already queued; preparation and approval are still required before applying",
        },
      ]);
      expect(writes).toHaveLength(2);
      expect(writes[1]!.status).toBe(status);
    },
  );
  it("does not return a key owned by another campaign or duplicate its active job", async () => {
    const { service, writes } = fixture();
    await service.enqueue("user", ["one", "two"]);
    writes[1]!.campaignId = "another-campaign";
    const resumed = await service.enqueue("user", ["two"]);
    expect(resumed.jobKeys).toEqual([]);
    expect(resumed.queued).toEqual([]);
    expect(resumed.skipped).toEqual([{ slug: "two", reason: "Already queued or applied" }]);
    expect(writes).toHaveLength(2);
  });
  it("scopes active-job and recorded-application dedupe to the authenticated account", async () => {
    const { service, activeQueries, applicationQueries } = fixture();
    await service.enqueue("alice", ["one", "old"]);
    expect(activeQueries).toHaveLength(1);
    expect(activeQueries[0]?.where.campaign).toEqual({ userId: "alice" });
    expect(applicationQueries).toHaveLength(3);
    expect(applicationQueries.every((query) => query.where.userId_url.userId === "alice")).toBe(
      true,
    );
  });
});
