import { prismaFixture } from "@/common/testing/prisma-fakes";
import { WorkQueueLimitsService } from "./work-queue.limits";
import { describe, expect, it } from "bun:test";

const uuid = () => crypto.randomUUID();

async function fixture() {
  const f = prismaFixture();
  const userId = uuid();
  const campaignId = uuid();
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
  const campaign = { campaignId, userId, status: "in_progress", config: {} };
  const job = {
    id: uuid(),
    campaignId,
    campaign,
    key: "readiness-fixture",
    title: "Synthetic Engineer",
    company: "Synthetic Employer",
    url: "https://jobs.ashbyhq.com/synthetic-employer/synthetic-job",
    status: "approved",
    submissionAttempt: null,
  };
  f.campaigns.push(campaign);
  f.jobs.push(job);
  const { items } = await f.queue.enqueue(userId, {
    idempotencyKey: uuid(),
    jobIds: [job.id],
    provider: "claude",
    source: "user",
  });
  const input = () => ({
    requestId: uuid(),
    runtimeId: uuid(),
    workerId: uuid(),
    workItemId: items[0].id,
    capabilities: { isolatedBrowser: true as const },
  });
  function collect(version = 1, coverage = "complete", required = "optional") {
    const collection = {
      id: uuid(),
      userId,
      jobId: job.id,
      version,
      coverage,
      source: "browser_dom",
      sourceUrl: job.url,
      collectorVersion: "synthetic-readiness-v1",
      authorship: "session_user",
      observedAt: new Date(),
      reason: null,
    };
    const definition = {
      stableKey: "fields:full_name",
      prompt: "Full name",
      required,
      visibility: "visible",
      condition: { state: "unconditional", rules: [] },
      groupMode: "all",
      fields: [{ key: "full_name", label: "Full name", type: "text", options: [] }],
    };
    const question = {
      id: uuid(),
      userId,
      jobId: job.id,
      collectionId: collection.id,
      revision: 1,
      stableKey: definition.stableKey,
      definition,
      definitionHash: "a".repeat(64),
      current: true,
      blocking: required === "required",
      createdAt: new Date(),
    };
    f.questionCollections.push(collection);
    f.applicationQuestions.push(question);
    return { collection, question };
  }
  return {
    ...f,
    userId,
    job,
    item: items[0],
    input,
    collect,
    limits: new WorkQueueLimitsService(f.db),
  };
}

describe("application collection readiness before execution reservation", () => {
  it("lets an unscanned job run so the worker can record its form", async () => {
    const f = await fixture();
    expect((await f.limits.estimate(f.userId)).counts.eligibleNow).toBe(1);
    const result = await f.queueClaims.claim(f.userId, f.input());
    expect(result.claim?.item.id).toBe(f.item.id);
    expect(f.workExecutions).toHaveLength(1);
  });

  it("admits partial coverage but blocks unanswered required questions", async () => {
    const f = await fixture();
    f.collect(1);
    f.collect(2, "partial");
    expect((await f.queueClaims.claim(f.userId, f.input())).blockedReason).toBeNull();
    const g = await fixture();
    g.collect(1, "complete", "required");
    expect(await g.queueClaims.claim(g.userId, g.input())).toMatchObject({
      claim: null,
      blockedReason: "questions",
    });
    expect(g.workExecutions).toHaveLength(0);
  });

  it("still admits an owned complete positive collection with a confirmed required answer", async () => {
    const f = await fixture();
    const { question } = f.collect(1, "complete", "required");
    f.questionAnswers.push({
      id: uuid(),
      userId: f.userId,
      questionId: question.id,
      values: [{ fieldKey: "full_name", value: "Synthetic Applicant" }],
      authorship: "session_user",
      confirmedAt: new Date(),
      createdAt: new Date(),
    });
    const result = await f.queueClaims.claim(f.userId, f.input());
    expect(result.blockedReason).toBeNull();
    expect(result.claim?.item.id).toBe(f.item.id);
    expect(f.workExecutions).toHaveLength(1);
  });
});
