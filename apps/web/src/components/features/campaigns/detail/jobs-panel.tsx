"use client";

import { type ReactElement, useRef, useState } from "react";
import { Autorenew, Clear, Replay } from "@mui/icons-material";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import type { GridRowSelectionModel } from "@mui/x-data-grid";
import { CAMPAIGN_JOB_STATUSES, type CampaignJobStatus } from "@openapply/contracts/campaign";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { campaignQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import type { CampaignDetailDto, CampaignJobDto } from "@/api/types";
import { SelectField, type SelectFieldOption } from "@/components/ui/form";
import { SectionCard } from "@/components/ui/layout";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { gridPagination, usePaginationParams } from "@/hooks/use-pagination";
import { useQueueActions } from "@/hooks/use-queue-actions";
import { plural } from "@/utils/format";
import { EMPTY_SELECTION, resolveSelectedRows } from "@/utils/grid-selection";
import { CampaignJobsTable, isReapplicable } from "./jobs-table";

const STATUS_OPTIONS: ReadonlyArray<SelectFieldOption<CampaignJobStatus>> =
  CAMPAIGN_JOB_STATUSES.map((s) => ({
    value: s,
    label: s,
  }));

const SEARCH_DEBOUNCE_MS = 300;

interface CampaignJobsPanelProps {
  campaign: CampaignDetailDto;
}

/** Jobs table with status/search filtering and bulk re-apply / rescan of selected jobs. */
export function CampaignJobsPanel(props: CampaignJobsPanelProps): ReactElement {
  const { campaign } = props;
  const queue = useQueueActions();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<CampaignJobStatus | null>(null);
  const [search, setSearch] = useState("");
  const pagination = usePaginationParams({ prefix: "jobs" });
  const [selection, setSelection] = useState<GridRowSelectionModel>(EMPTY_SELECTION);

  // Filters run server-side, so they cover the whole campaign rather than the loaded page.
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const jobs = useApiQuery(
    campaignQueries.jobs(campaign.campaignId, {
      ...pagination.query,
      status: statusFilter ?? undefined,
      search: term || undefined,
    }),
  );
  const visible = jobs.data?.items ?? [];
  const total = jobs.data?.pagination.total ?? 0;

  // The grid keeps off-page ids selected (keepNonExistentRowsSelected), so resolving
  // against the current page alone would silently drop selections made on other pages.
  const seenJobs = useRef(new Map<string, CampaignJobDto>());
  for (const job of visible) {
    seenJobs.current.set(job.id, job);
  }

  const canReapply = campaign.status !== "in_progress" && !campaign.config.discovery;
  const selected = canReapply
    ? resolveSelectedRows(selection, [...seenJobs.current.values()], visible).filter((j) =>
        isReapplicable(j.status),
      )
    : [];
  const selectedSkipped = selected.filter((j) => j.status === "skipped");
  const selectedForReapply = selected.filter((job) => job.status !== "skipped");
  const hasFilters = statusFilter !== null || term !== "";

  const resetPage = (): void => pagination.setPage(1);

  const resetSelection = (): void => {
    setSelection(EMPTY_SELECTION);
    for (const key of invalidations.campaign) queryClient.invalidateQueries({ queryKey: key });
  };

  async function reapplySelected(): Promise<void> {
    try {
      await queue.jobs.mutateAsync(selectedForReapply.map((job) => job.id));
      resetSelection();
    } catch {
      // Keep the exact selection available for an idempotent retry.
    }
  }

  async function rescanSelected(): Promise<void> {
    try {
      await queue.campaign.mutateAsync({
        campaignId: campaign.campaignId,
        action: "rescan",
        jobIds: selectedSkipped.map((job) => job.id),
      });
      resetSelection();
    } catch {
      // Keep the exact selection available for an idempotent retry.
    }
  }

  const applyJob = (job: CampaignJobDto): void => {
    queue.jobs.mutate([job.id]);
  };
  return (
    <SectionCard title="Jobs" description="Updated live as the search runs.">
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        sx={{ alignItems: { xs: "stretch", md: "center" }, mb: 2 }}
      >
        <SelectField
          label="Status"
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={(next) => {
            setStatusFilter(next);
            resetPage();
          }}
        />
        <TextField
          size="small"
          label="Search title / company"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          sx={{ minWidth: 220 }}
        />
        {hasFilters && (
          <Button
            size="small"
            variant="text"
            startIcon={<Clear fontSize="sm" />}
            onClick={() => {
              setStatusFilter(null);
              setSearch("");
              resetPage();
            }}
          >
            Clear
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {canReapply && selectedSkipped.length > 0 && (
          <Button
            variant="outlined"
            startIcon={<Autorenew fontSize="sm" />}
            onClick={() => void rescanSelected()}
            disabled={queue.campaign.isPending || selectedSkipped.length > 100}
          >
            Rescan selected ({selectedSkipped.length})
          </Button>
        )}
        {canReapply && selectedForReapply.length > 0 && (
          <Button
            variant="contained"
            startIcon={<Replay fontSize="sm" />}
            disabled={queue.jobs.isPending || selectedForReapply.length > 100}
            onClick={() => void reapplySelected()}
          >
            Re-apply selected ({selectedForReapply.length})
          </Button>
        )}
        <Typography variant="captionMuted">{plural(total, "job")}</Typography>
      </Stack>
      {(selectedSkipped.length > 100 || selectedForReapply.length > 100) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Select up to 100 jobs for each queue action.
        </Alert>
      )}
      <CampaignJobsTable
        rows={visible}
        onViewJob={(job) => window.open(job.url, "_blank", "noopener,noreferrer")}
        loading={jobs.isLoading}
        onApplyJob={!campaign.config.discovery ? applyJob : undefined}
        checkboxSelection={canReapply}
        rowSelectionModel={selection}
        onRowSelectionModelChange={setSelection}
        {...gridPagination(pagination, jobs.data?.pagination)}
      />
    </SectionCard>
  );
}
