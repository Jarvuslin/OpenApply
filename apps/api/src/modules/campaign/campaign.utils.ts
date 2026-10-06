import { campaignChannel, workspaceChannel } from "@jobpilot/contracts/sse";
import { findOwned } from "@/common/errors";
import { publish } from "@/common/sse";
import type {
  Campaign,
  CampaignSource,
  CampaignStatus,
  PrismaClient,
} from "@/generated/prisma/client";

/** Campaign kinds whose scored `pending` rows the pilot promotes: auto-apply and pasted links. */
export const PROMOTABLE_SOURCES: CampaignSource[] = ["auto_apply", "apply"];

export async function ensureCampaignOwned(
  prisma: PrismaClient,
  userId: string,
  campaignId: string,
): Promise<void> {
  await findOwned(
    (where) => prisma.campaign.findFirst({ where, select: { campaignId: true } }),
    { campaignId, userId },
    "Campaign",
  );
}

/** The SSE fan-out every status change emits, whichever path did the write. */
export function publishCampaignStatus(
  userId: string,
  campaign: Pick<Campaign, "campaignId" | "source">,
  status: CampaignStatus,
): void {
  const { campaignId, source } = campaign;
  publish(campaignChannel, { campaignId }, { type: "status", payload: { status } });
  if (status === "completed") {
    publish(workspaceChannel, { userId }, { type: "campaign.completed", campaignId });
  } else {
    publish(workspaceChannel, { userId }, { type: "campaign.updated", campaignId, status, source });
  }
}
