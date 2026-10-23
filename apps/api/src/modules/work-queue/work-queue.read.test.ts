import { workOrderedInputSchema } from "@openapply/contracts/work-queue";
import { prismaFixture } from "@/common/testing/prisma-fakes";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { collectReadyJob } from "./readiness-fakes";
import { WorkQueueReadService } from "./work-queue.read";
import { describe, expect, it } from "bun:test";

async function fixture() {
  const f = prismaFixture(),
    userId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const jobs = Array.from({ length: 3 }, (_, index) => ({
    id: crypto.randomUUID(),
    campaignId,
    campaign: { userId, status: "in_progress", config: {} },
    key: `job-${index}`,
    title: "Engineer",
    company: `Company ${index}`,
    url: `https://company${index}.example.test/jobs/1`,
    status: "approved",
  }));
  f.jobs.push(...jobs);
  for (const job of jobs) collectReadyJob(f, userId, job);
  f.campaigns.push({ campaignId, userId, status: "in_progress", config: {} });
  f.queuePolicies.push({
    userId,
    revision: 1,
    maxConcurrentWorkers: 1,
    dailyApplicationCap: 10,
    companyApplicationCap: 3,
    companyWindowDays: 7,
    domainDelaySeconds: 30,
    updatedAt: new Date(),
  });
  const items = (
    await f.queue.enqueue(userId, {
      idempotencyKey: crypto.randomUUID(),
      jobIds: jobs.map((job) => job.id),
      source: "user",
      provider: "codex",
    })
  ).items;
  const read = new WorkQueueReadService(f.db, {} as ScoringService);
  return { ...f, userId, jobs, items, read };
}

describe("owned read-only queue selection", () => {
  it("returns exactly the requested subset in persisted priority order without claims or writes", async () => {
    const f = await fixture();
    const [first, priority, omitted] = f.items;
    f.workItems.find((row) => row.id === priority.id)!.priorityRequestedAt = new Date(10);
    f.workItems.find((row) => row.id === omitted.id)!.priorityRequestedAt = new Date(1);
    const before = JSON.stringify({
      items: f.workItems,
      requests: f.workRequests,
      executions: f.workExecutions,
    });
    const result = await f.read.ordered(f.userId, { workItemIds: [first.id, priority.id] });
    expect(result.items.map((item) => item.workItemId)).toEqual([priority.id, first.id]);
    expect(result.items.every((item) => item.eligible)).toBe(true);
    expect(
      JSON.stringify({
        items: f.workItems,
        requests: f.workRequests,
        executions: f.workExecutions,
      }),
    ).toBe(before);
  });

  it("fails the entire request for missing, foreign or duplicate IDs", async () => {
    const f = await fixture();
    await expect(
      f.read.ordered(f.userId, { workItemIds: [f.items[0].id, crypto.randomUUID()] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.read.ordered(crypto.randomUUID(), { workItemIds: [f.items[0].id] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      workOrderedInputSchema.safeParse({ workItemIds: [f.items[0].id, f.items[0].id] }).success,
    ).toBe(false);
    expect(f.workExecutions).toHaveLength(0);
  });

  it("priority never bypasses current campaign eligibility", async () => {
    const f = await fixture();
    f.jobs[1].campaign.status = "paused";
    f.workItems.find((row) => row.id === f.items[1].id)!.priorityRequestedAt = new Date(1);
    const result = await f.read.ordered(f.userId, { workItemIds: [f.items[0].id, f.items[1].id] });
    expect(result.items[0]).toMatchObject({
      workItemId: f.items[1].id,
      eligible: false,
      blockedReason: "campaign_paused",
    });
    expect(result.items[1].eligible).toBe(true);
    expect(f.workExecutions).toHaveLength(0);
  });

  it("observes only the exact owned execution and rejects stopped or expired frames without renewing", async () => {
    const f = await fixture();
    const claim = (
      await f.queueClaims.claim(f.userId, {
        requestId: crypto.randomUUID(),
        runtimeId: crypto.randomUUID(),
        workerId: crypto.randomUUID(),
        workItemId: f.items[0].id,
        capabilities: { isolatedBrowser: true },
      })
    ).claim!;
    const query = {
      executionId: claim.ownership.executionId,
      browserSessionId: claim.ownership.browserSessionId,
    };
    const original = JSON.stringify(f.workItems);
    expect(await f.read.observer(f.userId, claim.item.id, query)).toMatchObject({
      ownerId: f.userId,
      currentExecutionId: claim.ownership.executionId,
      active: true,
    });
    expect(JSON.stringify(f.workItems)).toBe(original);
    await expect(f.read.observer(crypto.randomUUID(), claim.item.id, query)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.read.observer(f.userId, claim.item.id, { ...query, browserSessionId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    const row = f.workItems.find((item) => item.id === claim.item.id)!;
    row.pauseRequestedAt = new Date();
    expect((await f.read.observer(f.userId, claim.item.id, query)).active).toBe(false);
    row.pauseRequestedAt = null;
    row.leaseExpiresAt = new Date(0);
    expect((await f.read.observer(f.userId, claim.item.id, query)).active).toBe(false);
    expect(row.leaseExpiresAt).toEqual(new Date(0));
    row.leaseExpiresAt = new Date(Date.now() + 90_000);
    f.workExecutions[0].finishedAt = new Date();
    expect((await f.read.observer(f.userId, claim.item.id, query)).active).toBe(false);
    row.state = "submitted";
    row.leaseExpiresAt = null;
    const replacement = crypto.randomUUID();
    row.currentExecutionId = replacement;
    const beforeHistoricalRead = JSON.stringify(f.workItems);
    expect(await f.read.observer(f.userId, claim.item.id, query)).toMatchObject({
      executionId: claim.ownership.executionId,
      currentExecutionId: replacement,
      state: "submitted",
      active: false,
    });
    expect(JSON.stringify(f.workItems)).toBe(beforeHistoricalRead);
  });
});
