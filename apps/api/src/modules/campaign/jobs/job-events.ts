import type { CampaignSummary } from "@openapply/contracts/campaign";
import { campaignChannel, workspaceChannel } from "@openapply/contracts/sse";
import { publish } from "@/common/sse";
import type { CampaignSource, Job, PrismaClient } from "@/generated/prisma/client";
import { deriveCampaignSummary } from "../campaign.summary";

export function publishJob(userId: string, job: Job, kind: "added" | "updated"): void {
  const { campaignId } = job;
  publish(campaignChannel, { campaignId }, { type: "job-update", payload: { kind, job } });
  publish(
    workspaceChannel,
    { userId },
    {
      type: kind === "added" ? "campaignjob.created" : "campaignjob.updated",
      campaignId,
      key: job.key,
      ...(kind === "updated" && { status: job.status }),
    },
  );
}

export async function publishProgress(
  prisma: PrismaClient,
  campaignId: string,
  source: CampaignSource,
): Promise<CampaignSummary> {
  const summary = await deriveCampaignSummary(prisma, campaignId, source);
  publish(campaignChannel, { campaignId }, { type: "progress", payload: summary });
  return summary;
}

/** Every status move publishes the row and the campaign totals, so other viewers' tiles stay live. */
export function publishStatusChange(
  prisma: PrismaClient,
  userId: string,
  job: Job,
  source: CampaignSource,
): Promise<CampaignSummary> {
  publishJob(userId, job, "updated");
  return publishProgress(prisma, job.campaignId, source);
}
