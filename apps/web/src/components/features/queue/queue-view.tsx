"use client";

import { type ReactElement, useEffect, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Drawer,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { workQueueChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Hourglass, ListOrdered } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiQuery } from "@/api/hooks";
import { invalidations } from "@/api/query-keys";
import { queueQueries } from "@/api/queue-queries";
import { LinkButton } from "@/components/ui/buttons";
import { PaginationFooter } from "@/components/ui/data";
import { StatsPill } from "@/components/ui/display";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useSseChannel } from "@/lib/sse/client";
import { streamResumed } from "@/lib/sse/connection-status";
import { readLocalStorage, writeLocalStorage } from "@/utils/local-storage";
import { JobLoginCard } from "./job-login-card";
import { QueueLimitsPanel } from "./queue-limits-panel";
import { QueuePanel } from "./queue-panel";
import { QUEUE_VIEWS } from "./queue-state";
import { QueueTable } from "./queue-table";

type QueueViewValue = (typeof QUEUE_VIEWS)[number]["value"];

export function QueueView(): ReactElement {
  const hydrated = useHydrated();
  const { user } = useSession();
  if (!hydrated || !user) return <LinearProgress aria-label="Loading queue account" />;
  return <QueueContent key={user.id} />;
}

function QueueContent(): ReactElement {
  const pagination = usePaginationParams();
  const params = useSearchParams();
  const viewParam = params.get("view");
  const stored = readLocalStorage<string>(VIEW_STORAGE_KEY);
  const view: QueueViewValue =
    QUEUE_VIEWS.find((option) => option.value === (viewParam ?? stored))?.value ?? "active";
  const queryClient = useQueryClient();
  const streamStatus = useSseChannel(workQueueChannel, null, {
    onMessage: () => {
      for (const queryKey of invalidations.queue) void queryClient.invalidateQueries({ queryKey });
    },
  });
  const previousStatus = useRef(streamStatus);
  useEffect(() => {
    if (streamResumed(previousStatus.current, streamStatus)) {
      for (const queryKey of invalidations.queue) void queryClient.invalidateQueries({ queryKey });
    }
    previousStatus.current = streamStatus;
  }, [streamStatus, queryClient]);
  const list = useApiQuery(queueQueries.list({ ...pagination.query, view }), {
    refetchInterval: 15_000,
  });
  const summary = useApiQuery(queueQueries.summary(), { refetchInterval: 15_000 });
  const router = useRouter();
  const wide = useMediaQuery((theme) => theme.breakpoints.up("lg"));
  const selectedId = params.get("item");
  const panelOpen = !!selectedId;

  function select(id: string | null, activity = false): void {
    const next = new URLSearchParams(params.toString());
    next.delete("activity");
    if (id) next.set("item", id);
    else next.delete("item");
    if (id && activity) next.set("activity", "1");
    const query = next.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  return (
    <Box sx={{ mr: wide && panelOpen ? PANEL_WIDTH : 0 }}>
      <Stack spacing={3}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              lg: panelOpen ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
            },
            gap: 2,
            alignItems: "stretch",
          }}
        >
          <Box id="login">
            <JobLoginCard />
          </Box>
          <QueueLimitsPanel />
        </Box>
        {summary.data && (
          <StatsPill
            items={[
              {
                icon: <Clock {...PILL_ICON} />,
                value: summary.data.running,
                label: "applying now",
              },
              {
                icon: <CheckCircle2 {...PILL_ICON} />,
                value: summary.data.queued,
                label: "waiting",
              },
              {
                icon: <Hourglass {...PILL_ICON} />,
                value: summary.data.needsUser,
                label: "need you",
              },
            ]}
          />
        )}
        <SectionCard
          title={QUEUE_VIEWS.find((option) => option.value === view)?.label}
          icon={<ListOrdered size={18} strokeWidth={1.75} aria-hidden />}
          flush
          actions={
            <>
              <TextField
                select
                size="small"
                value={view}
                aria-label="Show"
                onChange={(event) => {
                  writeLocalStorage(VIEW_STORAGE_KEY, event.target.value);
                  pagination.setFilters({
                    view: event.target.value === "active" ? null : event.target.value,
                  });
                }}
              >
                {QUEUE_VIEWS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <LinkButton href="/discover" variant="contained" size="small">
                Add jobs
              </LinkButton>
            </>
          }
        >
          {list.isLoading && <LinearProgress aria-label="Loading queue items" />}
          {list.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
              sx={{ m: 2 }}
            >
              Could not load your queue. Reload before acting.
            </Alert>
          )}
          {!list.isLoading && !list.error && list.data?.items.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              Nothing here yet. Add jobs and they start on their own while your computer is
              connected.
            </Typography>
          )}
          {!list.error && !!list.data?.items.length && (
            <QueueTable
              items={list.data.items}
              selectedId={selectedId}
              compact={panelOpen}
              onSelect={select}
            />
          )}
          {list.data && (
            <Box sx={{ px: 2 }}>
              <PaginationFooter
                pagination={list.data.pagination}
                onPageChange={pagination.setPage}
                onPageSizeChange={pagination.setPageSize}
              />
            </Box>
          )}
        </SectionCard>
      </Stack>
      <Drawer
        anchor="right"
        variant={wide ? "persistent" : "temporary"}
        open={panelOpen}
        onClose={() => select(null)}
        slotProps={{
          paper: {
            sx: { width: { xs: 1, sm: PANEL_WIDTH * 8 }, borderLeft: 1, borderColor: "divider" },
          },
        }}
      >
        {selectedId && (
          <QueuePanel
            key={selectedId}
            id={selectedId}
            activity={params.get("activity") === "1"}
            onClose={() => select(null)}
          />
        )}
      </Drawer>
    </Box>
  );
}

/** In theme spacing units: 440px. */
const PANEL_WIDTH = 55;
/** The queue view you picked last, so leaving the page doesn't reset it. */
const VIEW_STORAGE_KEY = "openapply:queue-view";
const PILL_ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
