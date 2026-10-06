"use client";

import type { ReactElement } from "react";
import { campaignChannel } from "@jobpilot/contracts/sse";
import { Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { campaignQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useSseChannel } from "@/lib/sse/client";
import { CampaignHeaderCard } from "./detail/header-card";
import { CampaignJobsPanel } from "./detail/jobs-panel";
import { CampaignReasonBreakdown } from "./detail/reason-breakdown";
import { CampaignSummaryTiles } from "./detail/summary-tiles";

interface CampaignDetailProps {
  campaignId: string;
}

export function CampaignDetail(props: CampaignDetailProps): ReactElement {
  const { campaignId } = props;
  const queryClient = useQueryClient();

  const detail = useApiQuery(campaignQueries.detail(campaignId));

  const invalidate = (key: readonly unknown[]): void => {
    queryClient.invalidateQueries({ queryKey: key });
  };
  const invalidateDetail = (): void => invalidate(queryKeys.campaigns.detail(campaignId));

  useSseChannel(
    campaignChannel,
    { campaignId },
    {
      // Scoped per event type: a scoring pass emits one `job-update` per job, so a blanket
      // `campaigns.all` here would refetch every cached list, page and aggregate on each one.
      on: {
        progress: invalidateDetail,
        status: invalidateDetail,
        "job-update": () => {
          invalidate(queryKeys.campaigns.jobs(campaignId));
          invalidate(queryKeys.campaigns.reasons(campaignId));
          invalidateDetail();
        },
      },
    },
  );

  const campaign = detail.data;

  if (detail.isLoading) {
    return <LinearProgress />;
  }

  // Silently spinning forever is the failure mode this rules out.
  if (!campaign) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2Muted">Couldn't load this campaign.</Typography>
        <Button variant="text" size="small" onClick={() => void detail.refetch()}>
          Retry
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <CampaignHeaderCard campaign={campaign} />
      <CampaignSummaryTiles campaign={campaign} />
      <CampaignReasonBreakdown campaign={campaign} />
      <CampaignJobsPanel campaign={campaign} />
    </Stack>
  );
}

/** Its own component so the drafts are fetched only by the campaigns that have any. */
