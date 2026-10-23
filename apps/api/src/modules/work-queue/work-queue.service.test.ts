import { prismaFixture } from "@/common/testing/prisma-fakes";
import { collectReadyJob } from "./readiness-fakes";
import { describe, expect, it } from "bun:test";

const userId = "428b5804-f621-4c87-92f3-fa7b8a59a001";

function setup() {
  const f = prismaFixture();
  const job = {
    id: crypto.randomUUID(),
    key: "job-1",
    campaignId: crypto.randomUUID(),
    campaign: { userId, status: "in_progress" },
    status: "approved",
    title: "Engineer",
    company: "Example",
    url: "https://example.test/jobs/1",
    submissionAttempt: null,
  };
  f.jobs.push(job);
  collectReadyJob(f, userId, job);
  const request = {
    jobIds: [job.id],
    idempotencyKey: crypto.randomUUID(),
    source: "user" as const,
    provider: "codex" as const,
  };
  return { ...f, job, request };
}

describe("durable application queue", () => {
  it("admits a per-job identity and rejects changed retries", async () => {
    const f = setup();
    const first = await f.queue.enqueue(userId, f.request);
    expect(await f.queue.enqueue(userId, f.request)).toEqual(first);
    expect(
      (await f.queue.enqueue(userId, { ...f.request, idempotencyKey: crypto.randomUUID() }))
        .items[0].id,
    ).toBe(first.items[0].id);
    expect(f.workItems).toHaveLength(1);
    await expect(
      f.queue.enqueue(userId, { ...f.request, provider: "claude" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(f.queue.enqueue(crypto.randomUUID(), f.request)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("parks detached legacy submission reservations and never claims them", async () => {
    const f = setup();
    f.submissions.push({
      id: crypto.randomUUID(),
      userId,
      jobId: null,
      canonicalUrl: null,
      originalUrl: `${f.job.url}?utm_source=legacy`,
      legacyOutcomeUnknown: true,
    });
    const result = await f.queue.enqueue(userId, f.request);
    expect(result.items[0].state).toBe("needs_user");
    expect(await f.queue.claim(userId)).toBeNull();
    expect((await f.queue.control(userId, result.items[0].id, "stop")).state).toBe("needs_user");
    expect((await f.queue.control(userId, result.items[0].id, "pause")).state).toBe("needs_user");
    await expect(f.queue.control(userId, result.items[0].id, "resume")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("derives ready and filling on heartbeat and refuses success without a receipt", async () => {
    const f = setup();
    await f.queue.enqueue(userId, f.request);
    const claim = await f.queue.claim(userId);
    if (!claim) throw new Error("Expected application claim");
    expect(claim.item.state).toBe("preparing");
    expect((await f.queue.heartbeat(userId, claim.item.id, claim.leaseToken)).state).toBe("ready");
    f.job.status = "applying";
    expect((await f.queue.heartbeat(userId, claim.item.id, claim.leaseToken)).state).toBe(
      "filling",
    );
    f.job.status = "approved";
    expect((await f.queue.heartbeat(userId, claim.item.id, claim.leaseToken)).state).toBe(
      "filling",
    );
    expect(
      (
        await f.queue.finish(userId, claim.item.id, {
          leaseToken: claim.leaseToken,
          status: "completed",
        })
      ).state,
    ).toBe("needs_user");
    expect(f.applications).toHaveLength(0);
  });

  it("does not launch or explicitly resume application work while its campaign is paused", async () => {
    const f = setup();
    const result = await f.queue.enqueue(userId, f.request);
    f.job.campaign.status = "paused";
    expect(await f.queue.claim(userId)).toBeNull();
    expect(f.workItems[0].state).toBe("paused");
    await expect(f.queue.control(userId, result.items[0].id, "resume")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("campaign resume preserves paused preparation and resumes only ordinary application work", async () => {
    const f = setup();
    f.campaigns.push({
      campaignId: f.job.campaignId,
      userId,
      status: "in_progress",
      query: "Fixture",
      config: {},
    });
    const application = (await f.queue.enqueue(userId, f.request)).items[0];
    await f.queue.control(userId, application.id, "pause");
    const preparationId = crypto.randomUUID();
    const preparation = {
      ...f.workItems.find((row) => row.id === application.id)!,
      id: preparationId,
      identity: `intake-prepare:${preparationId}`,
      kind: "pilot_task",
      intent: "intake_prepare",
      jobId: null,
      state: "paused",
    };
    f.workItems.push(preparation);
    const before = structuredClone(preparation);
    f.campaigns[0].status = "paused";
    await f.queue.campaign(userId, f.job.campaignId, {
      idempotencyKey: crypto.randomUUID(),
      action: "resume",
      provider: "codex",
    });
    expect(f.workItems.find((row) => row.id === preparationId)).toEqual(before);
    expect(f.workItems.find((row) => row.id === application.id)?.state).toBe("queued");
  });
});

describe("removing queued work", () => {
  it("deletes waiting work and exposes the career-site url on the row", async () => {
    const f = setup();
    const result = await f.queue.enqueue(userId, f.request);
    expect(result.items[0].url).toBe(f.job.url);
    expect(await f.queue.remove(userId, result.items[0].id)).toEqual({ removed: true });
    expect(f.workItems).toHaveLength(0);
    await expect(f.queue.remove(crypto.randomUUID(), result.items[0].id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("stops running work before it can be removed", async () => {
    const f = setup();
    await f.queue.enqueue(userId, f.request);
    const claim = await f.queue.claim(userId);
    if (!claim) throw new Error("Expected application claim");
    expect(await f.queue.remove(userId, claim.item.id)).toEqual({ removed: false });
    expect(f.workItems).toHaveLength(1);
    expect(f.workItems[0].state).toBe("stopping");
  });
});

describe("run limit", () => {
  it("lists runnable work and uses one run per claim until none remain", async () => {
    const f = setup();
    await f.queue.enqueue(userId, f.request);
    f.queuePolicies.push({
      userId,
      revision: 1,
      maxConcurrentWorkers: 1,
      dailyApplicationCap: 10,
      companyApplicationCap: 3,
      companyWindowDays: 7,
      domainDelaySeconds: 30,
      runsRemaining: 1,
      updatedAt: new Date(),
    });
    expect((await f.queue.runnable(userId)).applicationIds).toHaveLength(1);
    expect(await f.queue.claim(userId)).not.toBeNull();
    expect(f.queuePolicies[0].runsRemaining).toBe(0);
    expect(await f.queue.runnable(userId)).toMatchObject({ applicationIds: [], runsRemaining: 0 });
  });

  it("offers one queued pilot scoring run on its own, apart from applications", async () => {
    const f = setup();
    await f.queue.enqueue(userId, f.request);
    f.queuePolicies.push({
      userId,
      revision: 1,
      maxConcurrentWorkers: 1,
      dailyApplicationCap: 10,
      companyApplicationCap: 3,
      companyWindowDays: 7,
      domainDelaySeconds: 30,
      runsRemaining: null,
      updatedAt: new Date(),
    });
    const application = f.workItems[0]!;
    const pilotId = "7b0f4c1e-5d3a-4e2b-9c8d-1a2b3c4d5e6f";
    f.workItems.push({
      ...application,
      id: pilotId,
      kind: "pilot_task",
      intent: "pilot_score",
      jobId: null,
      identity: `pilot-run:${pilotId}`,
    });
    const runnable = await f.queue.runnable(userId);
    expect(runnable.pilotIds).toEqual([pilotId]);
    expect(runnable.applicationIds).toEqual([String(application.id)]);
  });

  it("refuses a claim when no runs remain", async () => {
    const f = setup();
    await f.queue.enqueue(userId, f.request);
    f.queuePolicies.push({
      userId,
      revision: 1,
      maxConcurrentWorkers: 1,
      dailyApplicationCap: 10,
      companyApplicationCap: 3,
      companyWindowDays: 7,
      domainDelaySeconds: 30,
      runsRemaining: 0,
      updatedAt: new Date(),
    });
    expect(await f.queue.claim(userId)).toBeNull();
    expect(f.workItems[0].state).toBe("queued");
  });
});
