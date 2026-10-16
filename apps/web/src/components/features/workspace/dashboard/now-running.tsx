"use client";

import type { ReactElement } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Stack,
  type Theme,
  Tooltip,
  Typography,
} from "@mui/material";
import { ChevronRight, Pause, Plus, Search } from "lucide-react";
import type { Route } from "next";
import NextLink from "next/link";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { campaignQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import type { CampaignDto } from "@/api/types";
import {
  campaignShortName,
  campaignStage,
} from "@/components/features/campaigns/campaign-progress";
import { LinkButton } from "@/components/ui/buttons";
import { PaginationFooter } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";

const ROW_ACTION = {
  width: 28,
  height: 28,
  border: 1,
  borderColor: "divider",
  borderRadius: (theme: Theme) => theme.radii.sm,
};

export function NowRunning(): ReactElement {
  const pagination = usePaginationParams({ pageSize: 10, prefix: "running" });
  const campaigns = useApiQuery(
    campaignQueries.list({ ...pagination.query, status: ["in_progress"] }),
  );
  const running = campaigns.data?.items ?? [];

  return (
    <SectionCard
      flush
      fullHeight
      title="Searches"
      icon={<Search size={18} strokeWidth={1.75} aria-hidden />}
      actions={
        <LinkButton size="small" variant="text" href="/applications/searches">
          See all
        </LinkButton>
      }
    >
      <Stack>
        {campaigns.isPending && <LinearProgress />}
        {campaigns.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void campaigns.refetch()}>Retry</Button>}
          >
            Could not load ongoing campaigns.
          </Alert>
        )}
        {campaigns.data && !campaigns.error && campaigns.data.pagination.total === 0 && (
          <Typography variant="body2Muted" sx={{ p: 2 }}>
            No searches are running.
          </Typography>
        )}
        {campaigns.data &&
          !campaigns.error &&
          running.length === 0 &&
          campaigns.data.pagination.total > 0 && (
            <Alert
              severity="info"
              action={<Button onClick={() => pagination.setPage(1)}>First page</Button>}
            >
              No campaigns remain on this page.
            </Alert>
          )}
        {running.map((c) => (
          <RunningRow key={c.campaignId} campaign={c} />
        ))}
        <Box sx={{ px: 2, py: 1.25 }}>
          <LinkButton
            size="small"
            variant="text"
            href="/campaigns/new"
            startIcon={<Plus size={14} aria-hidden />}
          >
            New search
          </LinkButton>
        </Box>
        {campaigns.data && running.length > 0 && campaigns.data.pagination.totalPages > 1 && (
          <PaginationFooter
            pagination={campaigns.data.pagination}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        )}
      </Stack>
    </SectionCard>
  );
}

function RunningRow(props: { campaign: CampaignDto }): ReactElement {
  const { campaign } = props;
  const { summary } = campaign;
  const stage = campaignStage(campaign.source, summary);

  const pause = useApiMutation<{ campaignId: string; status: string }, void>(
    () =>
      api.campaigns({ id: campaign.campaignId }).status.post({ status: "paused", actor: "user" }),
    {
      successMessage: "Campaign paused",
      invalidate: invalidations.campaign,
    },
  );

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        pl: 2,
        pr: 1.5,
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <Typography variant="body2Strong" noWrap title={campaign.query}>
            {campaignShortName(campaign.query)}
          </Typography>
          <Chip
            size="small"
            label={stage}
            color={stage === "Ready to review" ? "success" : "info"}
          />
        </Stack>
        <Typography variant="captionMuted" noWrap component="p">
          {summary.totalFound} found · {summary.scored} scored · {summary.applied} applied
        </Typography>
      </Box>
      <Tooltip title="Pause search">
        <span>
          <IconButton
            size="small"
            aria-label="Pause search"
            disabled={pause.isPending}
            onClick={() => pause.mutate()}
            sx={ROW_ACTION}
          >
            <Pause size={14} strokeWidth={2} aria-hidden />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="View activity">
        <IconButton
          size="small"
          aria-label="View activity"
          component={NextLink}
          href={`/campaigns/${encodeURIComponent(campaign.campaignId)}` as Route}
          sx={ROW_ACTION}
        >
          <ChevronRight size={14} strokeWidth={2} aria-hidden />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
