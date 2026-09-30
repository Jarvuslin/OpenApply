import { CAMPAIGN_JOB_ACTIVE_STATUSES } from "@jobpilot/contracts/campaign";
import type { PrismaClient } from "@/generated/prisma/client";
import { publishCampaignStatus } from "@/modules/campaign/campaign.utils";
import type { PilotJournalService } from "../journal.service";
import { FINALIZE_IDLE_MS } from "./constants";

interface FinalizeDeps {
  prisma: PrismaClient;
  pilot: PilotJournalService;
}

/** Source-aware lookup of in-progress campaigns whose active work is exhausted. */
function gatherIdleCampaigns(prisma: PrismaClient, userId: string, now: Date) {
  // Idle guard: completing is terminal, and a user may be mid-session adding jobs in the
  // terminal - recent job activity means the campaign isn't ours to close yet.
  const idleCutoff = new Date(now.getTime() - FINALIZE_IDLE_MS);
  return prisma.campaign.findMany({
    where: {
      userId,
      status: "in_progress",
      jobs: { none: { updatedAt: { gt: idleCutoff } } },
      OR: [
        {
          source: { not: "networking" },
          jobs: { none: { status: { in: [...CAMPAIGN_JOB_ACTIVE_STATUSES] } } },
        },
        {
          source: "networking",
          networkingMessages: { none: { status: { in: ["draft", "approved"] } } },
        },
      ],
    },
    select: { campaignId: true, query: true, source: true },
  });
}

/**
 * Complete idle in-progress campaigns during agenda refresh. A bare status flip needs no agent
 * cycle - and as the lowest-priority agenda item it was permanently starved.
 */
export async function finalizeIdleCampaigns(
  { prisma, pilot }: FinalizeDeps,
  userId: string,
  now: Date,
): Promise<void> {
  const idle = await gatherIdleCampaigns(prisma, userId, now);
  const settled = await Promise.all(
    idle.map(async (campaign) => {
      // The status guard makes the sweep race-safe against a concurrent transition (commandStatus).
      const updated = await prisma.campaign.updateMany({
        where: { campaignId: campaign.campaignId, userId, status: "in_progress" },
        data: {
          status: "completed",
          statusActor: "pilot",
          statusReason: "No active work remaining.",
          completedAt: now,
        },
      });
      return updated.count === 0 ? null : campaign;
    }),
  );

  const completed = settled.filter((campaign) => campaign !== null);
  if (completed.length === 0) {
    return;
  }

  for (const campaign of completed) {
    publishCampaignStatus(userId, campaign, "completed");
  }
  await pilot.appendJournal(userId, {
    entries: completed.map((campaign) => ({
      kind: "action" as const,
      subjectType: "campaign",
      subjectId: campaign.campaignId,
      summary: `Completed campaign '${campaign.query}' - no active work remaining.`,
    })),
  });
}
