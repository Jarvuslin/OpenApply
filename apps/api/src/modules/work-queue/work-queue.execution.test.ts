import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { workExecution } from "./work-queue.execution";
import { describe, expect, it } from "bun:test";

const userId = "5d6c2f43-8e1a-4b7f-9a3e-2c1d0b9f8e7a";
const jobs = [
  { id: "0f3c5a2b-1d4e-4f6a-8b9c-0a1b2c3d4e5f", url: "https://jobs.lever.co/acme/1" },
  { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", url: "https://careers.example.com/jobs/2" },
];

function scoringItem(jobIds: string[]): WorkItem {
  return {
    id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    userId,
    kind: "pilot_task",
    intent: "pilot_score",
    provider: "claude",
    campaignId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    payload: { pilotId: "x", runId: "y", jobIds, resumeId: "z", minScore: 35 },
    reason: null,
  } as unknown as WorkItem;
}

function tx(owned: typeof jobs) {
  return {
    job: { findMany: async () => owned },
  } as unknown as Prisma.TransactionClient;
}

describe("pilot scoring execution", () => {
  it("hands the browser exactly the run's own job pages", async () => {
    const execution = await workExecution(tx(jobs), userId, scoringItem(jobs.map((job) => job.id)));
    expect(execution.scorePages).toEqual([
      { jobId: jobs[0]!.id, url: jobs[0]!.url },
      { jobId: jobs[1]!.id, url: jobs[1]!.url },
    ]);
    expect(execution.job).toBeNull();
    expect(execution.instructions).toContain("read-only");
  });

  it("refuses a run that lists a job the user no longer owns", async () => {
    await expect(
      workExecution(tx(jobs.slice(0, 1)), userId, scoringItem(jobs.map((job) => job.id))),
    ).rejects.toThrow("no longer own");
  });
});
