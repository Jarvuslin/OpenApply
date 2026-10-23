import { workClaimInputSchema } from "@openapply/contracts/work-queue";
import { prismaFixture } from "@/common/testing/prisma-fakes";
import { collectReadyJob } from "./readiness-fakes";
import { assertSubmissionLease } from "./submission-fence";
import { WorkQueueLimitsService } from "./work-queue.limits";
import { countReservations, workScope } from "./work-queue.limits-policy";
import { describe, expect, it } from "bun:test";

const uuid = () => crypto.randomUUID();
async function fixture(count = 4) {
  const f = prismaFixture();
  const userId = uuid();
  const campaignId = uuid();
  const policy = {
    userId,
    revision: 1,
    maxConcurrentWorkers: 3,
    dailyApplicationCap: 10,
    companyApplicationCap: 3,
    companyWindowDays: 7,
    domainDelaySeconds: 30,
    updatedAt: new Date(),
  };
  f.queuePolicies.push(policy);
  const campaign = { campaignId, userId, status: "in_progress", config: {} };
  f.campaigns.push(campaign);
  const jobs = Array.from({ length: count }, (_, i) => ({
    id: uuid(),
    campaignId,
    campaign,
    key: `job-${i}`,
    title: `Job ${i}`,
    company: `Company ${i}`,
    url: `https://domain${i}.test/jobs/${i}`,
    status: "approved",
    submissionAttempt: null,
  }));
  f.jobs.push(...jobs);
  for (const job of jobs) collectReadyJob(f, userId, job);
  const { items } = await f.queue.enqueue(userId, {
    idempotencyKey: uuid(),
    jobIds: jobs.map((job) => job.id),
    provider: "claude",
    source: "user",
  });
  f.workItems.forEach((item, index) => {
    item.createdAt = new Date(Date.now() + index);
  });
  const runtimeId = uuid();
  const input = (i = 0) => ({
    requestId: uuid(),
    runtimeId,
    workerId: uuid(),
    workItemId: items[i].id,
    capabilities: { isolatedBrowser: true as const },
  });
  const limits = new WorkQueueLimitsService(f.db);
  return { ...f, userId, policy, jobs, items, input, limits };
}

describe("bounded isolated work claims", () => {
  it("requires exact approved work and an isolated browser capability", () => {
    expect(workClaimInputSchema.safeParse({}).success).toBe(false);
    expect(
      workClaimInputSchema.safeParse({
        requestId: uuid(),
        runtimeId: uuid(),
        workerId: uuid(),
        workItemId: uuid(),
        capabilities: { isolatedBrowser: false },
      }).success,
    ).toBe(false);
  });
  it("atomically grants at most three distinct slots and browser process identities", async () => {
    const f = await fixture();
    const result = await Promise.all(
      f.items.map((_, i) => f.queueClaims.claim(f.userId, f.input(i))),
    );
    const claims = result.flatMap((row) => (row.claim ? [row.claim] : []));
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((row) => row.ownership.slot)).size).toBe(3);
    expect(new Set(claims.map((row) => row.ownership.browserSessionId)).size).toBe(3);
    expect(result[3].blockedReason).toBe("capacity");
    expect(
      result.every(
        (row) =>
          !row.claim ||
          (!!row.claim.execution.job?.url && row.claim.leaseExpiresAt > row.serverTime),
      ),
    ).toBe(true);
  });
  it("replays only one exact live claim, never a settled or changed request", async () => {
    const f = await fixture();
    const input = f.input();
    const [a, b] = await Promise.all([
      f.queueClaims.claim(f.userId, input),
      f.queueClaims.claim(f.userId, input),
    ]);
    expect(a.claim?.ownership).toEqual(b.claim?.ownership);
    expect(f.workExecutions).toHaveLength(1);
    await expect(
      f.queueClaims.claim(f.userId, { ...input, workItemId: f.items[1].id }),
    ).rejects.toMatchObject({ status: 409 });
    expect(a.claim).not.toBeNull();
    await f.queue.finish(f.userId, a.claim!.item.id, {
      leaseToken: a.claim!.leaseToken,
      status: "waiting",
    });
    expect((await f.queueClaims.claim(f.userId, input)).blockedReason).toBe("settled_request");
    expect(f.workExecutions).toHaveLength(1);
  });
  it("preserves denied request identity after capacity becomes free", async () => {
    const f = await fixture();
    f.policy.maxConcurrentWorkers = 1;
    const active = await f.queueClaims.claim(f.userId, f.input());
    const denied = f.input(1);
    expect((await f.queueClaims.claim(f.userId, denied)).blockedReason).toBe("capacity");
    await f.queue.finish(f.userId, active.claim!.item.id, {
      leaseToken: active.claim!.leaseToken,
      status: "waiting",
    });
    expect((await f.queueClaims.claim(f.userId, denied)).blockedReason).toBe("capacity");
    expect((await f.queueClaims.claim(f.userId, f.input(1))).claim).not.toBeNull();
  });
  it("refuses cross-account work and duplicate live worker ownership", async () => {
    const f = await fixture();
    const input = f.input();
    f.queuePolicies.push({ ...f.policy, userId: "other" });
    await expect(f.queueClaims.claim("other", input)).rejects.toMatchObject({ status: 404 });
    await f.queueClaims.claim(f.userId, input);
    expect(
      (
        await f.queueClaims.claim(f.userId, {
          ...input,
          requestId: uuid(),
          workItemId: f.items[1].id,
        })
      ).blockedReason,
    ).toBe("capacity");
  });
  it("reserves account and company caps before model work starts", async () => {
    const f = await fixture();
    f.policy.dailyApplicationCap = 2;
    const results = await Promise.all(
      f.items.map((_, i) => f.queueClaims.claim(f.userId, f.input(i))),
    );
    expect(results.filter((row) => row.claim)).toHaveLength(2);
    expect(results[2].blockedReason).toBe("daily_cap");
    const g = await fixture();
    g.policy.companyApplicationCap = 1;
    g.jobs[1].company = g.jobs[0].company;
    expect((await g.queueClaims.claim(g.userId, g.input())).claim).not.toBeNull();
    expect((await g.queueClaims.claim(g.userId, g.input(1))).blockedReason).toBe("company_cap");
  });
  it("holds one domain worker and retains cooldown after a safe pre-submit park", async () => {
    const f = await fixture();
    f.jobs[1].url = "https://domain0.test/jobs/other";
    const first = await f.queueClaims.claim(f.userId, f.input());
    expect((await f.queueClaims.claim(f.userId, f.input(1))).blockedReason).toBe("domain_busy");
    await f.queue.finish(f.userId, first.claim!.item.id, {
      leaseToken: first.claim!.leaseToken,
      status: "waiting",
    });
    expect(f.workExecutions[0].releasedAt).toBeInstanceOf(Date);
    expect((await f.queueClaims.claim(f.userId, f.input(1))).blockedReason).toBe("domain_pacing");
  });
  it("lease expiry frees capacity but never releases a begun ambiguous reservation", async () => {
    const f = await fixture();
    f.policy.dailyApplicationCap = 1;
    const first = await f.queueClaims.claim(f.userId, f.input());
    f.submissions.push({
      id: uuid(),
      userId: f.userId,
      jobId: f.jobs[0].id,
      canonicalUrl: f.jobs[0].url,
      originalUrl: f.jobs[0].url,
      startedAt: new Date(),
      recordedAt: null,
      legacyOutcomeUnknown: false,
      checkpoint: { job: { company: f.jobs[0].company } },
    });
    f.workItems[0].leaseExpiresAt = new Date(0);
    const next = await f.queueClaims.claim(f.userId, f.input(1));
    expect(next.blockedReason).toBe("daily_cap");
    expect(f.workExecutions[0].finishedAt).toBeInstanceOf(Date);
    expect(f.workExecutions[0].consumedAt).toBeInstanceOf(Date);
    expect(f.workExecutions[0].releasedAt).toBeNull();
    expect(
      (await f.queueClaims.claim(f.userId, { ...f.input(), workItemId: first.claim!.item.id }))
        .claim,
    ).toBeNull();
  });
  it("rechecks limits and exact company/domain scope at submission fence", async () => {
    const f = await fixture();
    const first = await f.queueClaims.claim(f.userId, f.input());
    const claimed = first.claim!;
    await assertSubmissionLease(f.db, f.userId, f.jobs[0].id, claimed.item.id, claimed.leaseToken);
    f.jobs[0].company = "Changed employer";
    await expect(
      assertSubmissionLease(f.db, f.userId, f.jobs[0].id, claimed.item.id, claimed.leaseToken),
    ).rejects.toThrow("scope changed");
  });
});

describe("queue policy and preflight", () => {
  it("saves only human revisions and replays a lost acknowledgement without another write", async () => {
    const f = await fixture();
    const input = {
      requestId: uuid(),
      expectedRevision: 1,
      maxConcurrentWorkers: 2,
      dailyApplicationCap: 11,
      companyApplicationCap: 4,
      companyWindowDays: 7,
      domainDelaySeconds: 45,
    };
    await expect(f.limits.update(f.userId, input, "agent")).rejects.toMatchObject({ status: 403 });
    const first = await f.limits.update(f.userId, input, "session_user");
    expect(first.revision).toBe(2);
    expect(await f.limits.update(f.userId, input, "session_user")).toEqual(first);
    await expect(
      f.limits.update(f.userId, { ...input, requestId: uuid() }, "session_user"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.workExecutions).toHaveLength(0);
  });
  it("estimates joint capacity, domain and quota without modifying queue state", async () => {
    const f = await fixture();
    f.jobs[1].url = "https://domain0.test/jobs/second";
    f.policy.dailyApplicationCap = 2;
    const before = JSON.stringify(f.workItems);
    const estimate = await f.limits.estimate(f.userId);
    expect(estimate.counts).toMatchObject({ queuedApplications: 4, eligibleNow: 2, deferred: 2 });
    expect(estimate.deferred.some((row) => row.reason === "domain_busy")).toBe(true);
    expect(estimate.usage.proRemaining).toBeNull();
    expect(estimate.usage.modelRequests).toBeNull();
    expect(JSON.stringify(f.workItems)).toBe(before);
    expect(f.workExecutions).toHaveLength(0);
  });
  it("counts unresolved reservations across midnight and company windows", () => {
    const policy = {
      revision: 1,
      maxConcurrentWorkers: 3,
      dailyApplicationCap: 10,
      companyApplicationCap: 3,
      companyWindowDays: 7,
      domainDelaySeconds: 30,
      updatedAt: null,
    };
    const now = new Date("2026-10-08T00:00:01Z");
    const facts = [
      { identity: "old", companyKey: null, at: new Date(0), unresolved: true, held: false },
      {
        identity: "yesterday",
        companyKey: "employer",
        at: new Date("2026-10-07T23:59:59Z"),
        unresolved: false,
        held: false,
      },
    ];
    expect(countReservations(facts, policy, "employer", now)).toEqual({ daily: 1, company: 2 });
    expect(
      workScope({ company: "Employer", url: "https://boards.eu.greenhouse.io/example" })?.domainKey,
    ).toBe("greenhouse.io");
    expect(
      workScope({ company: "Employer", url: "https://evilgreenhouse.io/example" })?.domainKey,
    ).toBe("evilgreenhouse.io");
  });
});
