import { prismaFixture } from "@/common/testing/prisma-fakes";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { collectReadyJob } from "./readiness-fakes";
import { WorkQueueReadService } from "./work-queue.read";
import { describe, expect, it } from "bun:test";

const userId = "428b5804-f621-4c87-92f3-fa7b8a59a002";
const campaignId = crypto.randomUUID();

function setup(count: number) {
  const f = prismaFixture();
  f.queuePolicies.push({
    userId,
    revision: 1,
    maxConcurrentWorkers: 1,
    dailyApplicationCap: 50,
    companyApplicationCap: 50,
    companyWindowDays: 7,
    domainDelaySeconds: 30,
    runsRemaining: null,
    updatedAt: new Date(),
  });
  const jobs = Array.from({ length: count }, (_, index) => {
    const job = {
      id: crypto.randomUUID(),
      key: `job-${index}`,
      campaignId,
      campaign: { userId, status: "in_progress" },
      status: "approved",
      title: "Engineer",
      company: `Example ${index}`,
      url: `https://example${index}.test/jobs/${index}`,
      fitAssessment: null as unknown,
      skipReason: null as string | null,
      submissionAttempt: null,
    };
    f.jobs.push(job);
    collectReadyJob(f, userId, job);
    return job;
  });
  const enqueue = () =>
    f.queue.enqueue(userId, {
      jobIds: jobs.map((job) => job.id),
      idempotencyKey: crypto.randomUUID(),
      source: "user",
      provider: "claude",
    });
  const batches = () => f.workItems.filter((row) => row.intent === "pilot_score");
  const applications = () => f.workItems.filter((row) => row.kind === "application");
  const read = new WorkQueueReadService(f.db, {} as ScoringService);
  const blocked = async (items: Record<string, unknown>[]) =>
    (await read.ordered(userId, { workItemIds: items.map((row) => String(row.id)) })).items.map(
      (item) => item.blockedReason,
    );
  return { ...f, jobs, enqueue, batches, applications, blocked };
}

describe("queue score batches", () => {
  it("scores the first five queued jobs in one run before any application starts", async () => {
    const f = setup(7);
    await f.enqueue();
    const runnable = await f.queue.runnable(userId);
    expect(f.batches()).toHaveLength(1);
    const batch = f.batches()[0]!;
    expect(runnable.pilotIds).toEqual([String(batch.id)]);
    expect(batch).toMatchObject({ kind: "pilot_task", campaignId, state: "queued" });
    const batched = (batch.payload as { jobIds: string[] }).jobIds;
    expect(new Set(batched).size).toBe(5);
    expect(batched.every((id) => f.jobs.some((job) => job.id === id))).toBeTrue();
    const inBatch = f.applications().filter((row) => batched.includes(String(row.jobId)));
    const rest = f.applications().filter((row) => !batched.includes(String(row.jobId)));
    expect(await f.blocked(inBatch)).toEqual(Array(5).fill("scoring"));
    expect(await f.blocked(rest)).not.toContain("scoring");
  });

  it("makes one batch at a time and none while a pilot is scoring", async () => {
    const f = setup(7);
    await f.enqueue();
    await f.queue.runnable(userId);
    await f.queue.runnable(userId);
    expect(f.batches()).toHaveLength(1);

    const g = setup(2);
    g.workItems.push({
      id: crypto.randomUUID(),
      userId,
      kind: "pilot_task",
      intent: "pilot_score",
      state: "queued",
      identity: "pilot-run:1",
      payload: { jobIds: [] },
    });
    await g.enqueue();
    await g.queue.runnable(userId);
    expect(g.batches()).toHaveLength(1);
    expect(
      g.applications().some((row) => (row.payload as { scoreBatchId?: string }).scoreBatchId),
    ).toBeFalse();
  });

  it("skips jobs the batch scored below the minimum without an application run", async () => {
    const f = setup(3);
    await f.enqueue();
    await f.queue.runnable(userId);
    const batch = f.batches()[0]!;
    f.jobs[0]!.status = "skipped";
    f.jobs[0]!.skipReason = "Scored 12, below your minimum of 60.";
    f.jobs[0]!.fitAssessment = { score: 12 };
    f.jobs[1]!.fitAssessment = { score: 80 };
    batch.state = "completed";
    await f.queue.runnable(userId);
    const [low, high, unread] = f.applications();
    expect(low).toMatchObject({ state: "skipped", reason: "Scored 12, below your minimum of 60." });
    expect(high!.state).toBe("queued");
    // A posting the batch couldn't read is scored inside its own run instead of looping.
    expect(unread!.state).toBe("queued");
    expect(f.batches()).toHaveLength(1);
    expect(await f.blocked([high!, unread!])).not.toContain("scoring");
  });

  it("waits while five scored jobs are ready to apply", async () => {
    const f = setup(6);
    for (const job of f.jobs.slice(0, 5)) job.fitAssessment = { score: 70 };
    await f.enqueue();
    await f.queue.runnable(userId);
    expect(f.batches()).toHaveLength(0);
    f.jobs[0]!.status = "applied";
    f.applications()[0]!.state = "submitted";
    await f.queue.runnable(userId);
    expect((f.batches()[0]!.payload as { jobIds: string[] }).jobIds).toEqual([f.jobs[5]!.id]);
  });
});
