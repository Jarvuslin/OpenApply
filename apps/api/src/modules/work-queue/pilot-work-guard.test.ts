import { prismaFixture } from "@/common/testing/prisma-fakes";
import type { Prisma } from "@/generated/prisma/client";
import { pilotWorkBlockedReason } from "./pilot-work-guard";
import { assertSubmissionLease } from "./submission-fence";
import { describe, expect, it } from "bun:test";

const userId = "428b5804-f621-4c87-92f3-fa7b8a59a001";
const pilot = { source: "pilot", kind: "application" };

describe("Pilot queue execution guard", () => {
  it("applies the current running flag and zero cap without blocking manual work", async () => {
    const f = prismaFixture();
    const tx = f.db as unknown as Prisma.TransactionClient;
    expect(await pilotWorkBlockedReason(tx, userId, pilot)).toContain("stopped");
    f.pilotStates.push({ userId, running: true, instructionsConfig: { dailyApplyCap: 0 } });
    expect(await pilotWorkBlockedReason(tx, userId, pilot)).toContain("limit");
    expect(await pilotWorkBlockedReason(tx, userId, { ...pilot, source: "user" })).toBeNull();
    expect(await pilotWorkBlockedReason(tx, userId, { ...pilot, kind: "pilot_task" })).toBeNull();
  });

  it("counts recorded submissions today and unresolved begun/legacy reservations across days", async () => {
    const f = prismaFixture();
    const tx = f.db as unknown as Prisma.TransactionClient;
    f.pilotStates.push({ userId, running: true, instructionsConfig: { dailyApplyCap: 3 } });
    f.applications.push(
      { userId, appliedAt: new Date() },
      { userId, appliedAt: new Date(0) },
      { userId: "other", appliedAt: new Date() },
    );
    f.submissions.push(
      { userId, recordedAt: null, startedAt: new Date(0), legacyOutcomeUnknown: false },
      { userId, recordedAt: null, startedAt: null, legacyOutcomeUnknown: true },
    );
    expect(await pilotWorkBlockedReason(tx, userId, pilot)).toContain("limit");
    f.submissions[0].recordedAt = new Date();
    expect(await pilotWorkBlockedReason(tx, userId, pilot)).toBeNull();
  });

  it("rechecks a cap or stop change at final Submit even after the lease was granted", async () => {
    const f = prismaFixture();
    const tx = f.db as unknown as Prisma.TransactionClient;
    const id = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();
    f.pilotStates.push({ userId, running: true, instructionsConfig: { dailyApplyCap: 1 } });
    f.workItems.push({
      id,
      userId,
      jobId,
      ...pilot,
      state: "filling",
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60000),
      pauseRequestedAt: null,
      cancellationRequestedAt: null,
    });
    const executionId = crypto.randomUUID();
    f.workItems[0].currentExecutionId = executionId;
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
    f.campaigns.push({ campaignId: "campaign", userId, config: {} });
    f.jobs.push({
      id: jobId,
      campaignId: "campaign",
      campaign: { userId },
      url: "https://fixture.test/job",
      company: "Fixture",
    });
    f.workExecutions.push({
      id: executionId,
      userId,
      workItemId: id,
      jobId,
      kind: "application",
      canonicalUrl: "https://fixture.test/job",
      companyKey: "fixture",
      domainKey: "fixture.test",
      finishedAt: null,
      releasedAt: null,
      consumedAt: null,
    });
    await assertSubmissionLease(tx, userId, jobId, id, leaseToken);
    f.applications.push({ userId, appliedAt: new Date() });
    await expect(assertSubmissionLease(tx, userId, jobId, id, leaseToken)).rejects.toMatchObject({
      status: 409,
    });
    f.applications.length = 0;
    f.pilotStates[0].running = false;
    await expect(assertSubmissionLease(tx, userId, jobId, id, leaseToken)).rejects.toMatchObject({
      status: 409,
    });
  });
});
