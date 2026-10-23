import { prismaFixture } from "@/common/testing/prisma-fakes";
import { collectReadyJob } from "./readiness-fakes";
import { describe, expect, it } from "bun:test";

describe("canonical application completion", () => {
  it("settles the exact browser execution in the same refresh that observes recorded submission", async () => {
    const f = prismaFixture();
    const userId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const job = {
      id: crypto.randomUUID(),
      campaignId,
      key: "recorded",
      status: "approved",
      campaign: { userId, status: "in_progress", config: {} },
      title: "Engineer",
      company: "Synthetic",
      url: "https://synthetic.example.test/jobs/1",
    };
    f.jobs.push(job);
    collectReadyJob(f, userId, job);
    f.campaigns.push({ campaignId, ...job.campaign });
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
    const { items } = await f.queue.enqueue(userId, {
      idempotencyKey: crypto.randomUUID(),
      jobIds: [job.id],
      source: "user",
      provider: "claude",
    });
    const claim = (
      await f.queueClaims.claim(userId, {
        requestId: crypto.randomUUID(),
        runtimeId: crypto.randomUUID(),
        workerId: crypto.randomUUID(),
        workItemId: items[0].id,
        capabilities: { isolatedBrowser: true },
      })
    ).claim!;
    const attempt = {
      id: crypto.randomUUID(),
      userId,
      jobId: job.id,
      originalUrl: job.url,
      canonicalUrl: job.url,
      applicationId: crypto.randomUUID(),
      startedAt: new Date(),
      receiptStoredAt: new Date(),
      recordedAt: new Date(),
      legacyOutcomeUnknown: false,
    };
    f.submissions.push(attempt);
    f.applications.push({ id: attempt.applicationId, userId, url: job.url });
    Object.assign(job, { status: "applied", submissionAttempt: attempt });
    const item = f.workItems[0];
    Object.assign(item, { job });
    expect(f.workExecutions[0].finishedAt).toBeNull();
    await f.queue.refresh(userId);
    expect(item).toMatchObject({
      state: "submitted",
      applicationId: attempt.applicationId,
      currentExecutionId: claim.ownership.executionId,
      leaseExpiresAt: null,
    });
    expect(f.workExecutions[0]).toMatchObject({
      id: claim.ownership.executionId,
      submissionAttemptId: attempt.id,
      releasedAt: null,
    });
    expect(f.workExecutions[0].finishedAt).toBeInstanceOf(Date);
    expect(f.workExecutions[0].consumedAt).toBeInstanceOf(Date);
    const saved = JSON.stringify({
      items: f.workItems,
      executions: f.workExecutions,
      attempts: f.submissions,
      applications: f.applications,
    });
    await f.queue.refresh(userId);
    expect(
      JSON.stringify({
        items: f.workItems,
        executions: f.workExecutions,
        attempts: f.submissions,
        applications: f.applications,
      }),
    ).toBe(saved);
    await expect(
      f.queue.heartbeat(userId, item.id as string, claim.leaseToken),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.workEvents).toHaveLength(0);
    expect(f.workExecutions).toHaveLength(1);
    expect(f.applications).toHaveLength(1);
  });
});
