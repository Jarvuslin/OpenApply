import { db } from "../src/common/database/prisma.client";
import { ResumeArtifactService } from "../src/modules/resume/resume-artifact.service";
import { OriginalResumeSource } from "../src/modules/scoring/original-source";
import { ScoringService } from "../src/modules/scoring/scoring.service";
import { WorkQueueClaimService } from "../src/modules/work-queue/work-queue.claim";
import { WorkQueueLimitsService } from "../src/modules/work-queue/work-queue.limits";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import { fixture, uuid } from "./question-regression-fixtures";

export const queue = new WorkQueueService(db);
export const artifacts = new ResumeArtifactService(db);
export const claims = new WorkQueueClaimService(
  db,
  queue,
  artifacts,
  new ScoringService(db, new OriginalResumeSource()),
);
export const limits = new WorkQueueLimitsService(db);

export async function concurrencyFixture(
  label: string,
  count = 4,
  options: { email?: string; password?: string } = {},
) {
  const f = await fixture(label, { ...options, approved: true });
  const base = uuid();
  const jobs = [
    await db.job.update({
      where: { id: f.job.id },
      data: { url: `https://d0-${base}.example.test/jobs/0`, company: "Concurrency Company 0" },
    }),
  ];
  for (let i = 1; i < count; i++)
    jobs.push(
      await db.job.create({
        data: {
          campaignId: f.campaign.campaignId,
          key: `job-${i}`,
          title: `${label} ${i}`,
          company: `Concurrency Company ${i}`,
          url: `https://d${i}-${base}.example.test/jobs/${i}`,
          status: "approved",
        },
      }),
    );
  const items = (
    await queue.enqueue(f.user.id, {
      idempotencyKey: uuid(),
      jobIds: jobs.map((job) => job.id),
      source: "user",
      provider: "claude",
    })
  ).items;
  const runtimeId = uuid();
  const input = (i = 0) => ({
    requestId: uuid(),
    runtimeId,
    workerId: uuid(),
    workItemId: items[i].id,
    capabilities: { isolatedBrowser: true as const },
  });
  const policy = async (
    overrides: Partial<{
      maxConcurrentWorkers: number;
      dailyApplicationCap: number;
      companyApplicationCap: number;
      companyWindowDays: number;
      domainDelaySeconds: number;
    }> = {},
  ) => {
    const current = await limits.read(f.user.id);
    return limits.update(
      f.user.id,
      {
        requestId: uuid(),
        expectedRevision: current.revision,
        maxConcurrentWorkers: 3,
        dailyApplicationCap: 10,
        companyApplicationCap: 3,
        companyWindowDays: 7,
        domainDelaySeconds: 30,
        ...overrides,
      },
      "session_user",
    );
  };
  return { ...f, jobs, items, input, policy };
}
