"use client";

import type { ReactElement, ReactNode } from "react";
import { Add } from "@mui/icons-material";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import type { CampaignStatus } from "@openapply/contracts/campaign";
import { useApiQuery } from "@/api/hooks";
import { campaignQueries } from "@/api/queries";
import { CampaignRow } from "@/components/features/campaigns";
import { LinkButton } from "@/components/ui/buttons";
import { EmptyState, PaginationFooter } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useWorkspaceUpdates } from "../use-workspace-updates";

/** Each group is its own server-filtered page, so neither can hide behind the other's rows. */
const GROUPS = [
  { key: "active", label: "Active", statuses: ["in_progress", "paused"] },
  { key: "completed", label: "Completed", statuses: ["completed", "failed"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: CampaignStatus[] }>;

const PAGE_SIZE = 10;

export function CampaignGroups(): ReactElement {
  useWorkspaceUpdates();

  const groups = [useCampaignGroup(GROUPS[0]), useCampaignGroup(GROUPS[1])];
  const isEmpty = groups.every((g) => !g.isPending && !g.error && g.pagination?.total === 0);

  return (
    <SectionCard
      title="Saved searches"
      description="The agent runs each search for you and scores what it finds. Auto-apply searches add every job above your cutoff to your queue."
      actions={
        <LinkButton
          size="small"
          variant="contained"
          startIcon={<Add fontSize="md" />}
          href="/campaigns/new"
        >
          New search
        </LinkButton>
      }
    >
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title="No saved searches yet"
          description="Describe the job you want and choose a board. Use Search mode to review matches before applying."
          action={
            <LinkButton size="small" variant="outlined" href="/campaigns/new">
              Start a search
            </LinkButton>
          }
        />
      ) : (
        <Stack spacing={2}>
          {groups.map((group) => (
            <CampaignGroupSection key={group.label} group={group} />
          ))}
        </Stack>
      )}
    </SectionCard>
  );
}

interface CampaignGroupSectionProps {
  group: ReturnType<typeof useCampaignGroup>;
}

function CampaignGroupSection(props: CampaignGroupSectionProps): ReactNode {
  const { group } = props;
  const { pagination } = group;

  if (group.isPending)
    return <LinearProgress aria-label={`Loading ${group.label.toLowerCase()} searches`} />;
  if (group.error) {
    return (
      <Alert severity="error" action={<Button onClick={() => void group.refetch()}>Retry</Button>}>
        Could not load {group.label.toLowerCase()} searches.
      </Alert>
    );
  }

  if (!pagination?.total) {
    return null;
  }

  if (group.items.length === 0) {
    return (
      <Alert severity="info" action={<Button onClick={() => group.setPage(1)}>First page</Button>}>
        No {group.label.toLowerCase()} searches remain on this page.
      </Alert>
    );
  }

  return (
    <Stack spacing={1}>
      <Typography variant="overlineMuted">
        {group.label} · {pagination.total}
      </Typography>
      {group.items.map((c) => (
        <CampaignRow key={c.campaignId} campaign={c} />
      ))}
      {/* The group heading already carries the total, so a one-page footer is noise. */}
      {pagination.totalPages > 1 && (
        <PaginationFooter
          pagination={pagination}
          onPageChange={group.setPage}
          onPageSizeChange={group.setPageSize}
        />
      )}
    </Stack>
  );
}

/** One paginated status group, with its own `?activePage=` / `?completedPage=` params. */
function useCampaignGroup(group: (typeof GROUPS)[number]) {
  const { query, setPage, setPageSize } = usePaginationParams({
    pageSize: PAGE_SIZE,
    prefix: group.key,
  });
  const result = useApiQuery(campaignQueries.list({ ...query, status: [...group.statuses] }));

  return {
    label: group.label,
    items: result.data?.items ?? [],
    pagination: result.data?.pagination,
    isPending: result.isPending,
    error: result.error,
    refetch: result.refetch,
    setPage,
    setPageSize,
  };
}
