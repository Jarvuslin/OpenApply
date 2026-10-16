import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { workItemView } from "./work-queue.view";
import { describe, expect, test } from "bun:test";

const userId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const pickedResume = "00000000-0000-4000-8000-000000000003";
const searchResume = "00000000-0000-4000-8000-000000000004";

const item = {
  id: "00000000-0000-4000-8000-000000000005",
  userId,
  kind: "pilot_task",
  intent: null,
  state: "queued",
  source: "user",
  provider: "claude",
  jobId,
  jobKey: "linear-frontend",
  campaignId: null,
  applicationId: null,
  title: "Senior Frontend Engineer",
  company: "Linear",
  reason: null,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  finishedAt: null,
  leaseExpiresAt: null,
  cancellationRequestedAt: null,
  pauseRequestedAt: null,
  priorityRequestedAt: null,
} as unknown as WorkItem;

function tx(selections: { resumeId: string }[]) {
  const labels: Record<string, string> = {
    [pickedResume]: "Frontend.pdf",
    [searchResume]: "General.pdf",
  };
  return {
    job: {
      findUnique: async () => ({
        url: "https://jobs.lever.co/linear/1",
        matchScore: 92,
        campaign: { config: { resumeId: searchResume } },
        documentSelections: selections,
      }),
    },
    resume: {
      findFirst: async ({ where }: { where: { id: string } }) => ({ label: labels[where.id] }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("workItemView", () => {
  test("shows the job's fit and the resume picked for the application", async () => {
    const view = await workItemView(tx([{ resumeId: pickedResume }]), userId, item);
    expect(view.matchScore).toBe(92);
    expect(view.resumeLabel).toBe("Frontend.pdf");
  });

  test("falls back to the search's resume before one is picked", async () => {
    const view = await workItemView(tx([]), userId, item);
    expect(view.resumeLabel).toBe("General.pdf");
  });
});
