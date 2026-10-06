import type {
  CampaignJobStatus,
  CampaignJobSummary,
  CampaignSummary,
} from "@jobpilot/contracts/campaign";
import { CAMPAIGN_JOB_STATUSES } from "@jobpilot/contracts/campaign";
import { type Campaign, type CampaignSource, Prisma } from "@/generated/prisma/client";

type SummaryClient = Pick<Prisma.TransactionClient, "job">;
type CampaignRef = Pick<Campaign, "campaignId" | "source">;

interface StatusCount {
  status: string;
  count: number;
  scored?: number;
}

export type WithSummary<T> = T & { summary: CampaignSummary };

/**
 * The roll-ups beside `byStatus` stay on the wire because installed agent skills read them
 * (`summary.applied` gates the max-applications cap); deriving them here keeps them in step.
 */
export function jobSummary(rows: StatusCount[]): CampaignJobSummary {
  const byStatus = Object.fromEntries(CAMPAIGN_JOB_STATUSES.map((status) => [status, 0])) as Record<
    CampaignJobStatus,
    number
  >;
  let scored = 0;
  for (const row of rows) {
    byStatus[row.status as CampaignJobStatus] += row.count;
    scored += row.scored ?? 0;
  }
  const totalFound = CAMPAIGN_JOB_STATUSES.reduce((n, status) => n + byStatus[status], 0);

  return {
    kind: "jobs",
    totalFound,
    qualified: totalFound - byStatus.skipped,
    applied: byStatus.applied,
    failed: byStatus.failed,
    skipped: byStatus.skipped,
    remaining: byStatus.approved + byStatus.applying + byStatus.needs_user,
    byStatus,
    scored,
  };
}

export function emptySummary(): CampaignSummary {
  return jobSummary([]);
}

/** Each campaign with its summary, derived from current rows in three aggregate queries. */
export async function summarizeCampaigns<T extends CampaignRef>(
  client: SummaryClient,
  campaigns: T[],
): Promise<WithSummary<T>[]> {
  const ids = campaigns.map((c) => c.campaignId);
  const jobCounts = ids.length
    ? await client.job.groupBy({
        by: ["campaignId", "status"],
        where: { campaignId: { in: ids } },
        _count: { _all: true, matchScore: true },
      })
    : [];
  return campaigns.map((campaign) => ({
    ...campaign,
    summary: jobSummary(
      jobCounts
        .filter((row) => row.campaignId === campaign.campaignId)
        .map((row) => ({
          status: row.status,
          count: row._count._all,
          scored: row._count.matchScore,
        })),
    ),
  }));
}

export async function deriveCampaignSummary(
  client: SummaryClient,
  campaignId: string,
  source: CampaignSource,
): Promise<CampaignSummary> {
  const [campaign] = await summarizeCampaigns(client, [{ campaignId, source }]);
  return campaign.summary;
}
