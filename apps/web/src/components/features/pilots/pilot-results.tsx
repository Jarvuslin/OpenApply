"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import {
  ChevronDown,
  Clock,
  ExternalLink,
  ListPlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { type PilotResultDto, pilotQueries } from "@/api/pilot-queries";
import { invalidations } from "@/api/query-keys";
import { CompanyLogo } from "@/components/ui/display";
import { DropdownMenu } from "@/components/ui/feedback";
import { formatRelativeTime } from "@/utils/format";
import { LEVEL_OPTIONS, WORK_MODE_OPTIONS, windowLabel } from "./pilot-format";
import { Rise } from "./pilot-motion";

const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;
const HEADERS = [
  { key: "select", label: "" },
  { key: "job", label: "Job" },
  { key: "company", label: "Company" },
  { key: "match", label: "Match" },
  { key: "level", label: "Level" },
  { key: "posted", label: "Posted" },
  { key: "actions", label: "" },
];
const COLUMNS = "56px minmax(0, 1fr) minmax(140px, 0.6fr) 96px 96px 120px 150px";

export type ResultView = "review" | "added" | "removed";
export type ResultSort = "newest" | "match";

const EMPTY: Record<ResultView, [string, string]> = {
  review: ["No jobs to review yet", "Run this pilot to find jobs that match your criteria."],
  added: ["No jobs added yet", "Jobs you add to your queue from this pilot show up here."],
  removed: ["No removed jobs", "Jobs you remove from review show up here."],
};

interface EmptyResultsProps {
  view: ResultView;
  running: boolean;
}

function EmptyResults({ view, running }: EmptyResultsProps): ReactElement {
  const [title, detail] = EMPTY[view];
  return (
    <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", px: 3, pt: 3, pb: 5 }}>
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          width: 56,
          height: 56,
          mb: 0.5,
          borderRadius: "50%",
          bgcolor: "surfaces.elevated",
          color: "text.secondary",
        }}
      >
        <Search size={22} strokeWidth={1.75} aria-hidden />
      </Box>
      <Typography variant="body1Strong">{title}</Typography>
      <Typography variant="body2Muted">
        {running && view === "review" ? "Jobs appear here as they are scored." : detail}
      </Typography>
    </Stack>
  );
}

interface PilotResultsProps {
  pilotId: string;
  view: ResultView;
  running: boolean;
  sort: ResultSort;
  onSortChange: (sort: ResultSort) => void;
}

export function PilotResults(props: PilotResultsProps): ReactElement {
  const { pilotId, view, running, sort, onSortChange: setSort } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const results = useApiQuery(
    pilotQueries.results(pilotId, { status: view, sort, page: 1, limit: 100 }),
    { refetchInterval: running ? 5_000 : false },
  );
  const action = useApiMutation<
    { updated: number; skipped: { resultId: string; reason: string }[] },
    { kind: "queue" | "remove"; ids?: string[] }
  >(
    async ({ kind, ids }) => {
      const body = ids ? { resultIds: ids } : { all: true };
      const route = api.pilots({ id: pilotId }).results;
      const response =
        kind === "queue" ? await route.queue.post(body) : await route.remove.post(body);
      if (response.error) throw new ApiError(response.error);
      return { data: response.data, error: null };
    },
    {
      invalidate: invalidations.pilots,
      successMessage: (data, { kind }) =>
        kind === "queue" ? `${data.updated} added to your queue.` : `${data.updated} removed.`,
      onSuccess: () => setSelected([]),
    },
  );
  const items = results.data?.items ?? [];
  const groups = new Map<number | null, PilotResultDto[]>();
  for (const item of items)
    groups.set(item.windowMinutes, [...(groups.get(item.windowMinutes) ?? []), item]);
  const reviewing = view === "review";
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <Box>
      {reviewing && items.length > 0 && (
        <Box sx={{ p: 0.75 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={(theme) => ({
              alignItems: "center",
              flexWrap: "wrap",
              px: 2,
              py: 1,
              borderRadius: theme.radii.md,
              bgcolor: selected.length ? "statusTints.info" : "surfaces.elevated",
            })}
          >
            <Checkbox
              size="small"
              checked={allSelected}
              indeterminate={selected.length > 0 && !allSelected}
              onChange={() => setSelected(allSelected ? [] : items.map((item) => item.id))}
              slotProps={{ input: { "aria-label": "Select all" } }}
            />
            {selected.length > 0 && (
              <>
                <Typography variant="body2Strong">{selected.length} selected</Typography>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Plus {...ICON} />}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: "queue", ids: selected })}
                >
                  Add to queue
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Trash2 {...ICON} />}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: "remove", ids: selected })}
                >
                  Remove
                </Button>
              </>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              size="small"
              startIcon={<ListPlus {...ICON} />}
              disabled={action.isPending}
              onClick={() => action.mutate({ kind: "queue" })}
            >
              Queue all {results.data?.pagination.total ?? items.length}
            </Button>
            {selected.length > 0 ? (
              <Link component="button" variant="body2" onClick={() => setSelected([])}>
                Clear selection
              </Link>
            ) : (
              <Button
                size="small"
                disabled={action.isPending}
                onClick={() => action.mutate({ kind: "remove" })}
              >
                Remove all
              </Button>
            )}
          </Stack>
        </Box>
      )}
      {results.isLoading && <LinearProgress aria-label="Loading results" />}
      {action.data?.skipped.length ? (
        <Alert severity="warning" sx={{ m: 2 }}>
          {action.data.skipped.length} could not be added: {action.data.skipped[0]?.reason}
        </Alert>
      ) : null}
      {!results.isLoading && items.length === 0 && <EmptyResults view={view} running={running} />}
      {items.length > 0 && (
        <Rise>
          <Box
            role="table"
            aria-label="Pilot results"
            sx={{ display: "grid", gridTemplateColumns: COLUMNS }}
          >
            <Box role="row" sx={{ display: "contents" }}>
              {HEADERS.map(({ key, label }, index) => (
                <Stack
                  key={key}
                  role="columnheader"
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: "center",
                    minHeight: 40,
                    px: index === 0 ? 2.25 : 1.5,
                    bgcolor: "surfaces.elevated",
                    borderTop: 1,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  {label === "Match" ? (
                    <Button
                      size="small"
                      color="inherit"
                      endIcon={<ChevronDown size={13} aria-hidden />}
                      onClick={() => setSort(sort === "match" ? "newest" : "match")}
                      sx={{ px: 0, minWidth: 0, color: "text.secondary" }}
                    >
                      Match
                    </Button>
                  ) : (
                    <Typography variant="captionMuted">{label}</Typography>
                  )}
                </Stack>
              ))}
            </Box>
            {[...groups.entries()].map(([minutes, rows]) => (
              <Box key={String(minutes)} sx={{ display: "contents" }}>
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{
                    gridColumn: "1 / -1",
                    alignItems: "center",
                    px: 2.25,
                    py: 1.25,
                    bgcolor: "surfaces.elevated",
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Clock {...ICON} />
                  <Typography variant="body2">
                    {sort === "newest" ? windowLabel(minutes) : "Best matches first"}
                  </Typography>
                  <Typography variant="captionMuted">{rows.length} jobs</Typography>
                </Stack>
                {rows.map((row) => (
                  <ResultRow
                    key={row.id}
                    row={row}
                    view={view}
                    checked={selected.includes(row.id)}
                    busy={action.isPending}
                    onCheck={() =>
                      setSelected(
                        selected.includes(row.id)
                          ? selected.filter((id) => id !== row.id)
                          : [...selected, row.id],
                      )
                    }
                    onQueue={() => action.mutate({ kind: "queue", ids: [row.id] })}
                    onRemove={() => action.mutate({ kind: "remove", ids: [row.id] })}
                  />
                ))}
              </Box>
            ))}
          </Box>
        </Rise>
      )}
    </Box>
  );
}

interface ResultRowProps {
  row: PilotResultDto;
  view: ResultView;
  checked: boolean;
  busy: boolean;
  onCheck: () => void;
  onQueue: () => void;
  onRemove: () => void;
}

function ResultRow(props: ResultRowProps): ReactElement {
  const { row, view, checked, busy, onCheck, onQueue, onRemove } = props;
  const posted = row.postedAt ? formatRelativeTime(row.postedAt) : "—";
  const mode = WORK_MODE_OPTIONS.find((option) => option.value === row.workMode)?.label;
  const level = LEVEL_OPTIONS.find((option) => option.value === row.level)?.label ?? "—";
  const strong = (row.matchScore ?? 0) >= 80;
  const cell = {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    px: 1.5,
    py: 1.25,
    borderBottom: 1,
    borderColor: "divider",
    bgcolor: checked ? "surfaces.hover" : "transparent",
  } as const;
  return (
    <Box role="row" sx={{ display: "contents" }}>
      <Box role="cell" sx={{ ...cell, px: 1.5 }}>
        {view === "review" && (
          <Checkbox
            size="small"
            checked={checked}
            onChange={onCheck}
            slotProps={{ input: { "aria-label": `Select ${row.title}` } }}
          />
        )}
      </Box>
      <Box role="cell" sx={cell}>
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="body1" noWrap title={row.title}>
            {row.title}
          </Typography>
          <Typography variant="body2Muted" noWrap>
            {[row.location, mode, posted].filter(Boolean).join(" · ")}
          </Typography>
        </Stack>
      </Box>
      <Box role="cell" sx={{ ...cell, gap: 1.25 }}>
        <CompanyLogo url={row.url} size={24} />
        <Typography variant="body2Strong" noWrap>
          {row.company}
        </Typography>
      </Box>
      <Box role="cell" sx={cell}>
        <Typography variant="body2Strong" color={strong ? "success.main" : "text.primary"}>
          {row.matchScore === null ? "—" : `${row.matchScore}%`}
        </Typography>
      </Box>
      <Box role="cell" sx={cell}>
        <Typography variant="body2Muted">{level}</Typography>
      </Box>
      <Box role="cell" sx={cell}>
        <Typography variant="body2Muted">{posted}</Typography>
      </Box>
      <Box role="cell" sx={{ ...cell, justifyContent: "flex-end", gap: 0.5 }}>
        {view === "review" && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<Plus {...ICON} />}
            disabled={busy}
            onClick={onQueue}
          >
            Queue
          </Button>
        )}
        {view === "added" && <Typography variant="captionMuted">In queue</Typography>}
        <DropdownMenu
          trigger={({ onOpen }) => (
            <IconButton size="small" aria-label={`More for ${row.title}`} onClick={onOpen}>
              <MoreHorizontal size={16} aria-hidden />
            </IconButton>
          )}
          items={[
            {
              kind: "item",
              key: "open",
              label: "Open posting",
              icon: <ExternalLink {...ICON} />,
              onClick: () => window.open(row.url, "_blank", "noopener,noreferrer"),
            },
            {
              kind: "item",
              key: "remove",
              label: "Remove from list",
              icon: <Trash2 {...ICON} />,
              danger: true,
              show: view === "review",
              disabled: busy,
              onClick: onRemove,
            },
          ]}
        />
      </Box>
    </Box>
  );
}
