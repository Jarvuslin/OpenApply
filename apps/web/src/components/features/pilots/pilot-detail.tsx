"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowDownUp,
  Check,
  Loader,
  MoreHorizontal,
  Pencil,
  Play,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { type PilotDto, pilotQueries } from "@/api/pilot-queries";
import { invalidations } from "@/api/query-keys";
import { LinkButton } from "@/components/ui/buttons";
import { DropdownMenu } from "@/components/ui/feedback";
import { useConfirm } from "@/providers/confirm-provider";
import { formatRelativeTime, plural } from "@/utils/format";
import { intervalLabel, ruleChips, ruleSubtitle } from "./pilot-format";
import { Count, Rise, Spin } from "./pilot-motion";
import { PilotBreadcrumb, PilotStatusPill, useComputerOffline } from "./pilot-parts";
import { PilotResults, type ResultSort, type ResultView } from "./pilot-results";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const VIEW_TITLES: Record<ResultView, string> = {
  review: "Jobs to review",
  added: "Added to queue",
  removed: "Removed",
};

interface PilotDetailProps {
  id: string;
}

export function PilotDetail({ id }: PilotDetailProps): ReactElement {
  const [view, setView] = useState<ResultView>("review");
  const [sort, setSort] = useState<ResultSort>("newest");
  const detail = useApiQuery(pilotQueries.detail(id), {
    refetchInterval: (query) => (query.state.data?.lastRun?.state === "scoring" ? 5_000 : 30_000),
  });
  const pilot = detail.data;
  if (detail.isLoading) return <LinearProgress aria-label="Loading pilot" />;
  if (!pilot) return <Alert severity="error">This pilot no longer exists.</Alert>;
  const running = pilot.lastRun?.state === "scoring";
  return (
    <Stack spacing={2.5}>
      <Header pilot={pilot} running={running} />
      <SettingsCard pilot={pilot} running={running} />
      {running && pilot.lastRun && <ProgressCard pilot={pilot} />}
      <Card>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", px: 3, pt: 2.5, pb: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <Typography variant="h3" component="h2">
                {VIEW_TITLES[view]}
              </Typography>
              <Chip size="small" label={pilot.counts[view]} />
            </Stack>
            <Stack direction="row" spacing={3} sx={{ mt: 1.5, flexWrap: "wrap" }}>
              <Stat value={pilot.lastRun?.scanned ?? 0} label="scanned" />
              <Stat value={pilot.lastRun?.matched ?? 0} label="matched" />
              <Stat
                value={pilot.counts.review}
                label="to review"
                active={view === "review"}
                onClick={() => setView("review")}
              />
              <Stat
                value={pilot.counts.added}
                label="added"
                active={view === "added"}
                onClick={() => setView("added")}
              />
              <Stat
                value={pilot.counts.removed}
                label="removed"
                active={view === "removed"}
                onClick={() => setView("removed")}
              />
            </Stack>
          </Box>
          <TextField
            select
            size="small"
            value={sort}
            onChange={(event) => setSort(event.target.value as ResultSort)}
            slotProps={{
              htmlInput: { "aria-label": "Sort jobs" },
              input: { startAdornment: <ArrowDownUp {...ICON} /> },
            }}
            sx={{ minWidth: 180, "& .MuiSelect-select": { pl: 1 } }}
          >
            <MenuItem value="newest">Newest first</MenuItem>
            <MenuItem value="match">Best match first</MenuItem>
          </TextField>
        </Stack>
        <PilotResults
          pilotId={pilot.id}
          view={view}
          running={running}
          sort={sort}
          onSortChange={setSort}
        />
      </Card>
    </Stack>
  );
}

interface StatProps {
  value: number;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function Stat({ value, label, active = false, onClick }: StatProps): ReactElement {
  const content = (
    <Typography component="span" variant="body2" color={active ? "text.primary" : "text.secondary"}>
      <Count value={value} /> {label}
    </Typography>
  );
  if (!onClick) return <Box>{content}</Box>;
  return (
    <Link
      component="button"
      underline={active ? "always" : "hover"}
      color="inherit"
      onClick={onClick}
      sx={{ textUnderlineOffset: 6 }}
    >
      {content}
    </Link>
  );
}

interface PilotProps {
  pilot: PilotDto;
  running: boolean;
}

function Header({ pilot, running }: PilotProps): ReactElement {
  const router = useRouter();
  const offline = useComputerOffline();
  const confirm = useConfirm();
  const run = useApiMutation(() => api.pilots({ id: pilot.id }).run.post(), {
    invalidate: invalidations.pilots,
    successMessage: "Looking for jobs.",
  });
  const remove = useApiMutation(() => api.pilots({ id: pilot.id }).delete(), {
    invalidate: invalidations.pilots,
    successMessage: "Pilot deleted.",
    onSuccess: () => router.push("/pilots"),
  });
  return (
    <Stack spacing={1.5}>
      <PilotBreadcrumb current={pilot.name} />
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="h2" component="h1" noWrap>
              {pilot.name}
            </Typography>
            <PilotStatusPill pilot={pilot} />
          </Stack>
          <Typography variant="body2Muted" sx={{ mt: 0.5 }}>
            {ruleSubtitle(pilot.rules, pilot.minScore)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <LinkButton
            href={`/pilots/${pilot.id}/edit` as Route}
            variant="outlined"
            startIcon={<Pencil {...ICON} />}
          >
            Edit search
          </LinkButton>
          <Button
            variant="contained"
            startIcon={
              (running && !offline) || run.isPending ? (
                <Spin>
                  <Loader {...ICON} />
                </Spin>
              ) : (
                <Play {...ICON} />
              )
            }
            disabled={running || run.isPending}
            title={running ? "This pilot is already looking for jobs" : undefined}
            onClick={() => run.mutate()}
          >
            {running && offline && "Waiting…"}
            {running && !offline && "Running…"}
            {!running && "Run now"}
          </Button>
          <DropdownMenu
            trigger={({ onOpen }) => (
              <IconButton
                aria-label="More pilot actions"
                onClick={onOpen}
                sx={{ border: 1, borderColor: "divider" }}
              >
                <MoreHorizontal {...ICON} />
              </IconButton>
            )}
            items={[
              {
                kind: "item",
                key: "delete",
                label: "Delete pilot",
                icon: <Trash2 {...ICON} />,
                danger: true,
                onClick: async () => {
                  const ok = await confirm({
                    title: `Delete ${pilot.name}?`,
                    description: "It stops looking. Jobs already added to your queue stay there.",
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (ok) remove.mutate();
                },
              },
            ]}
          />
        </Stack>
      </Stack>
    </Stack>
  );
}

function SettingsCard({ pilot, running }: PilotProps): ReactElement {
  const offline = useComputerOffline();
  const toggle = useApiMutation<unknown, boolean>(
    async (autoRun) => {
      const response = await api.pilots({ id: pilot.id }).patch({ autoRun });
      if (response.error) throw new ApiError(response.error);
      return { data: response.data, error: null };
    },
    { invalidate: invalidations.pilots },
  );
  let status = "";
  if (running && pilot.lastRun)
    status = `${offline ? "Waiting for your computer" : "Running now"} · started ${formatRelativeTime(pilot.lastRun.startedAt)} ago`;
  else if (pilot.autoRun && pilot.nextRunAt)
    status = `Next run in ${formatRelativeTime(pilot.nextRunAt)}`;
  const schedule = [
    pilot.autoRun ? intervalLabel(pilot.intervalMinutes) : "Runs when you press Run now",
    `Up to ${plural(pilot.maxJobsPerRun, "job")} per run`,
    pilot.autoRun && pilot.mode === "queue" ? "Adds matches to your queue" : "",
  ].filter(Boolean);
  return (
    <Card>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "center",
          px: 3,
          py: 1.75,
          borderBottom: 1,
          borderColor: "divider",
          flexWrap: "wrap",
        }}
      >
        <Switch
          checked={pilot.autoRun}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
          slotProps={{ input: { "aria-label": "Auto run" } }}
        />
        <Typography variant="body2Strong">
          {pilot.autoRun ? "Auto-run enabled" : "Auto-run off"}
        </Typography>
        <Typography variant="body2Muted">{schedule.join(" · ")}</Typography>
        <Box sx={{ flex: 1 }} />
        {status && <Typography variant="body2Muted">{status}</Typography>}
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", px: 3, py: 2, gap: 1, flexWrap: "wrap" }}>
        {ruleChips(pilot.rules, pilot.minScore).map((chip) => (
          <Chip key={chip} variant="outlined" label={chip} />
        ))}
        <Box sx={{ flex: 1 }} />
        <Link
          href={`/pilots/${pilot.id}/edit`}
          underline="hover"
          color="text.primary"
          variant="body2"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <SlidersHorizontal {...ICON} /> See all filters
        </Link>
      </Stack>
    </Card>
  );
}

interface ProgressCardProps {
  pilot: PilotDto;
}

type StepState = "done" | "active" | "waiting" | "todo";

interface StepMarkProps {
  state: StepState;
}

function StepMark({ state }: StepMarkProps): ReactElement {
  if (state === "done")
    return (
      <Rise>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: 1.5,
            borderColor: "statusDots.done",
            color: "statusDots.done",
          }}
        >
          <Check size={12} strokeWidth={3} aria-hidden />
        </Box>
      </Rise>
    );
  if (state === "active")
    return <CircularProgress size={20} thickness={4.5} aria-label="In progress" />;
  return (
    <Box
      sx={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: 1.5,
        borderStyle: state === "waiting" ? "dashed" : "solid",
        borderColor: state === "waiting" ? "statusDots.waiting" : "line.borderHi",
      }}
    />
  );
}

function ProgressCard({ pilot }: ProgressCardProps): ReactNode {
  const run = pilot.lastRun;
  const offline = useComputerOffline();
  const stop = useApiMutation(() => api.pilots({ id: pilot.id }).stop.post(), {
    invalidate: invalidations.pilots,
    successMessage: "Stopped. Jobs scored so far are kept.",
  });
  if (!run) return null;
  const total = Math.max(1, Math.min(run.matched, pilot.maxJobsPerRun));
  const progress = 50 + (run.scored / total) * 50;
  const steps: { label: string; detail: ReactNode; state: StepState }[] = [
    {
      label: "Checked job feeds",
      detail: (
        <>
          <Count value={run.scanned} /> postings in your time window
        </>
      ),
      state: "done",
    },
    {
      label: "Matched your rules",
      detail: (
        <>
          <Count value={run.matched} /> new jobs fit your rules
        </>
      ),
      state: "done",
    },
    offline
      ? {
          label: "Waiting for your computer",
          detail: `Scoring runs on your computer. ${run.scored} of ${total} scored so far.`,
          state: "waiting",
        }
      : {
          label: "Scoring fit against your resume",
          detail: (
            <>
              <Count value={run.scored} /> of {total} scored
            </>
          ),
          state: "active",
        },
    { label: "Ready for review", detail: "You can review once this finishes", state: "todo" },
  ];
  return (
    <Card sx={{ px: 3, py: 2.5 }}>
      <Stack spacing={2.25}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          {!offline && (
            <Spin>
              <Loader {...ICON} />
            </Spin>
          )}
          <Typography variant="h4" component="h2">
            {offline ? "Paused until your computer connects" : "Looking for jobs"}
          </Typography>
        </Stack>
        {offline && (
          <Alert
            severity="warning"
            action={
              <LinkButton href={"/install" as Route} color="inherit" size="small">
                Set up companion
              </LinkButton>
            }
          >
            The OpenApply companion on your computer is not connected, so no jobs can be scored.
            Start it and this run picks up where it stopped.
          </Alert>
        )}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <LinearProgress
            variant={offline ? "determinate" : "buffer"}
            value={progress}
            valueBuffer={Math.min(100, progress + 12)}
            color={offline ? "warning" : "primary"}
            sx={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              "& .MuiLinearProgress-bar": { transition: "transform 600ms ease" },
            }}
            aria-label="Run progress"
          />
          <Typography variant="captionMuted">Step 3 of 4</Typography>
        </Stack>
        <Stack component="ol" spacing={1.75} sx={{ m: 0, p: 0, listStyle: "none" }}>
          {steps.map((step) => (
            <Stack
              key={step.label}
              component="li"
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "flex-start" }}
            >
              <StepMark state={step.state} />
              <Box>
                <Typography
                  variant={
                    step.state === "active" || step.state === "waiting" ? "body2Strong" : "body2"
                  }
                  color={step.state === "todo" ? "text.disabled" : "text.primary"}
                >
                  {step.label}
                </Typography>
                <Typography variant="captionMuted" component="p">
                  {step.detail}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Square size={14} aria-hidden />}
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop looking
          </Button>
          <Typography variant="captionMuted">
            Jobs scored so far are kept. Run now is off until this run ends.
          </Typography>
        </Stack>
      </Stack>
    </Card>
  );
}
