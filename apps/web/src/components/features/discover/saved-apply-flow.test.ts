import { type ApplicationPlan, queueSelectedJobs } from "./saved-apply-flow";
import { describe, expect, test } from "bun:test";

function plan(slugs: string[]): ApplicationPlan {
  return { remainingSlugs: slugs, campaignId: null, workItemIds: [], queued: 0, skipped: [] };
}

function result(slugs: string[]) {
  return {
    campaignId: "selected-campaign",
    queued: slugs,
    skipped: [],
    workItemIds: slugs.map((slug) => `work-${slug}`),
  };
}

describe("saved application queue admission", () => {
  test("continues only the exact unconfirmed batch after an API failure", async () => {
    const original = plan(Array.from({ length: 105 }, (_, index) => `job-${index}`));
    let remaining = original;
    const admitted: string[] = [];
    let requests = 0;
    await expect(
      queueSelectedJobs(
        original,
        async (slugs) => {
          if (++requests === 2) throw new Error("API unavailable");
          admitted.push(...slugs);
          return result(slugs);
        },
        (next) => {
          remaining = next;
        },
      ),
    ).rejects.toThrow("API unavailable");
    expect(remaining.remainingSlugs).toEqual(original.remainingSlugs.slice(100));
    remaining = await queueSelectedJobs(
      remaining,
      async (slugs) => {
        admitted.push(...slugs);
        return result(slugs);
      },
      () => {},
    );
    expect(admitted).toEqual(original.remainingSlugs);
    expect(remaining.remainingSlugs).toEqual([]);
    expect(remaining.queued).toBe(105);
    expect(remaining.workItemIds).toHaveLength(105);
    expect(original.remainingSlugs).toHaveLength(105);
  });

  test("lost acknowledgements never advance the reviewed selection", async () => {
    const original = plan(["explicit-job"]);
    const completed: ApplicationPlan[] = [];
    await expect(
      queueSelectedJobs(
        original,
        async () => {
          throw new Error("Response lost");
        },
        (next) => completed.push(next),
      ),
    ).rejects.toThrow("Response lost");
    expect(completed).toEqual([]);
    expect(original.remainingSlugs).toEqual(["explicit-job"]);
  });

  test("already queued work is linked without launching another agent conversation", async () => {
    const updated = await queueSelectedJobs(
      plan(["duplicate", "new"]),
      async (slugs) => {
        expect(slugs).toEqual(["duplicate", "new"]);
        return {
          campaignId: "campaign",
          queued: ["new"],
          skipped: [{ slug: "duplicate", reason: "Already queued" }],
          workItemIds: ["existing", "created"],
        };
      },
      () => {},
    );
    expect(updated.workItemIds).toEqual(["existing", "created"]);
    expect(updated.skipped).toEqual(["Already queued"]);
  });
});
