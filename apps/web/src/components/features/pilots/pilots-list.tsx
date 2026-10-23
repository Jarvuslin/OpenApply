"use client";

import type { MouseEvent, ReactElement } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { ChevronRight, Loader, Pencil, Play, Plus, Zap } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { type PilotDto, pilotQueries } from "@/api/pilot-queries";
import { invalidations } from "@/api/query-keys";
import { LinkButton } from "@/components/ui/buttons";
import { formatDate, formatRelativeTime, plural } from "@/utils/format";
import { intervalLabel } from "./pilot-format";
import { Spin } from "./pilot-motion";
import { PilotMeta, PilotStatusPill } from "./pilot-parts";

const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;

export function PilotsList(): ReactElement {
  const list = useApiQuery(pilotQueries.list(), {
    refetchInterval: (query) =>
      query.state.data?.some((pilot) => pilot.lastRun?.state === "scoring") ? 5_000 : 30_000,
  });
  if (list.isLoading) return <LinearProgress aria-label="Loading pilots" />;
  if (list.error) return <Alert severity="error">Could not load your pilots.</Alert>;
  const pilots = list.data ?? [];
  if (!pilots.length)
    return (
      <Card sx={{ p: 4, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <Zap size={24} strokeWidth={1.75} aria-hidden />
          <Typography variant="h4" component="h2">
            No pilots yet
          </Typography>
          <Typography variant="body2Muted" sx={{ maxWidth: 420 }}>
            A pilot looks for new jobs that match your rules, scores them against your resume, and
            holds them for review or adds them to your queue.
          </Typography>
          <LinkButton
            href={"/pilots/new" as Route}
            variant="contained"
            startIcon={<Plus {...ICON} />}
          >
            New pilot
          </LinkButton>
        </Stack>
      </Card>
    );
  return (
    <Card>
      <Box
        role="table"
        aria-label="Your pilots"
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 210px 170px auto",
          columnGap: 3,
          px: 1,
          pb: 1,
        }}
      >
        <Box role="row" sx={{ display: "contents" }}>
          {["Pilot", "Schedule", "Last run", ""].map((label, index) => (
            <Box
              key={label || "actions"}
              role="columnheader"
              sx={{ pt: 2, pb: 1.25, pl: index === 0 ? 2 : 0 }}
            >
              <Typography variant="body2Strong">{label}</Typography>
            </Box>
          ))}
        </Box>
        {pilots.map((pilot) => (
          <PilotRow key={pilot.id} pilot={pilot} />
        ))}
      </Box>
    </Card>
  );
}

function lastRunLines(pilot: PilotDto, running: boolean): [string, string] {
  if (running) return ["Running now", `${pilot.lastRun?.scored ?? 0} scored so far`];
  const next =
    pilot.autoRun && pilot.nextRunAt ? `Next run in ${formatRelativeTime(pilot.nextRunAt)}` : "";
  if (!pilot.lastRun) return ["Never run", next];
  return [formatDate(pilot.lastRun.startedAt), `${plural(pilot.lastRun.matched, "job")} found`];
}

interface PilotRowProps {
  pilot: PilotDto;
}

function PilotRow({ pilot }: PilotRowProps): ReactElement {
  const router = useRouter();
  const running = pilot.lastRun?.state === "scoring";
  const href = `/pilots/${pilot.id}` as Route;
  const run = useApiMutation(() => api.pilots({ id: pilot.id }).run.post(), {
    invalidate: invalidations.pilots,
    successMessage: "Looking for jobs.",
  });
  const toggle = useApiMutation<unknown, boolean>(
    async (autoRun) => {
      const response = await api.pilots({ id: pilot.id }).patch({ autoRun });
      if (response.error) throw new ApiError(response.error);
      return { data: response.data, error: null };
    },
    { invalidate: invalidations.pilots },
  );
  const [lastRun, lastRunNote] = lastRunLines(pilot, running);

  // The whole row opens the pilot, except clicks on its own controls.
  function open(event: MouseEvent<HTMLElement>): void {
    if (event.target instanceof Element && event.target.closest("a, button, input, label")) return;
    router.push(href);
  }

  return (
    <Box
      role="row"
      onClick={open}
      sx={{
        gridColumn: "1 / -1",
        display: "grid",
        gridTemplateColumns: "subgrid",
        alignItems: "center",
        py: 2,
        borderRadius: 2,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
        "& + &": { borderTop: 1, borderColor: "divider" },
        "&:hover, &:hover + &": { borderTopColor: "transparent" },
      }}
    >
      <Stack role="cell" spacing={0.75} sx={{ minWidth: 0, pl: 2 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
          <Link href={href} underline="hover" color="text.primary" variant="body1Strong" noWrap>
            {pilot.name}
          </Link>
          <PilotStatusPill pilot={pilot} />
        </Stack>
        {pilot.rules.roles.length > 0 && (
          <Typography variant="body2Muted" noWrap>
            {pilot.rules.roles.join(" • ")}
          </Typography>
        )}
        <PilotMeta pilot={pilot} />
      </Stack>
      <Stack role="cell" direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <Switch
          size="small"
          checked={pilot.autoRun}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
          slotProps={{ input: { "aria-label": `Auto run for ${pilot.name}` } }}
        />
        <Box>
          <Typography variant="body2" color={pilot.autoRun ? "text.primary" : "text.secondary"}>
            {pilot.autoRun ? intervalLabel(pilot.intervalMinutes) : "Auto run off"}
          </Typography>
          <Typography variant="captionMuted">
            Up to {plural(pilot.maxJobsPerRun, "job")} per run
          </Typography>
        </Box>
      </Stack>
      <Box role="cell">
        <Typography variant="body2">{lastRun}</Typography>
        {lastRunNote && <Typography variant="captionMuted">{lastRunNote}</Typography>}
      </Box>
      <Stack role="cell" direction="row" spacing={1} sx={{ alignItems: "center", pr: 1 }}>
        <LinkButton
          href={`/pilots/${pilot.id}/edit` as Route}
          size="small"
          variant="outlined"
          startIcon={<Pencil {...ICON} />}
        >
          Edit
        </LinkButton>
        <Button
          size="small"
          variant="outlined"
          startIcon={
            running || run.isPending ? (
              <Spin>
                <Loader {...ICON} />
              </Spin>
            ) : (
              <Play {...ICON} />
            )
          }
          disabled={running || run.isPending}
          onClick={() => run.mutate()}
        >
          {running ? "Looking…" : "Run now"}
        </Button>
        <IconButton size="small" aria-label={`Open ${pilot.name}`} href={href}>
          <ChevronRight {...ICON} />
        </IconButton>
      </Stack>
    </Box>
  );
}
