"use client";

import type { ReactElement, ReactNode } from "react";
import { networkingMode, type PilotState } from "@jobpilot/contracts/pilot";
import { Grid, LinearProgress, Stack, Typography } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { StatCard } from "@/components/ui/display";

interface MeterProps {
  label: string;
  value: number;
  cap: number;
  /** Turns the bar red, so a capped pilot doesn't read as broken. */
  spent: boolean;
}

function Meter(props: MeterProps): ReactElement {
  const { label, value, cap, spent } = props;
  const percent = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography variant="body2Muted">{label}</Typography>
        <Typography variant="body2" color={spent ? "error.main" : "text.primary"}>
          {value} / {cap}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={percent} color={spent ? "error" : "primary"} />
    </Stack>
  );
}

/** The API sends bucket slugs, so this stays the only copy of the wording. */
const SKIP_LABELS: Record<string, string> = {
  sponsorship: "No visa sponsorship",
  citizenship: "Citizenship required",
  clearance: "Security clearance required",
  alreadyApplied: "Already applied",
  captcha: "CAPTCHA",
  payment: "Payment required",
  belowMinScore: "Below min score",
  capReached: "Daily cap reached",
  postingClosed: "Posting closed",
  wentStale: "Went stale before applying",
  goalsChanged: "Dropped when goals changed",
  unanswered: "Question went unanswered",
  other: "Other",
};

/** Past this ratio of skips to applies, the searches or the score bar are wrong, not the pilot. */
const SKIP_RATIO_WARNING = 2;

const TOP_REASONS = 3;

interface TodayOutcomesProps {
  appliedToday: number;
}

/** Without this, "16 applied" beside 52 quiet skips reads as a slow day, not a bad search. */
function TodayOutcomes(props: TodayOutcomesProps): ReactNode {
  const { appliedToday } = props;
  const outcomes = useApiQuery(pilotQueries.todayOutcomes()).data;

  if (!outcomes || outcomes.skipped + outcomes.failed === 0) {
    return null;
  }

  const parts = [`${appliedToday} applied`, `${outcomes.skipped} skipped`];
  if (outcomes.failed > 0) {
    parts.push(`${outcomes.failed} failed`);
  }
  const mostlySkipped = outcomes.skipped > Math.max(appliedToday, 1) * SKIP_RATIO_WARNING;

  return (
    <Stack spacing={0.5}>
      <Typography variant="captionMuted">{parts.join(" · ")}</Typography>
      {outcomes.skipReasons.slice(0, TOP_REASONS).map((row) => (
        <Stack key={row.reason} direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="captionMuted">
            {SKIP_LABELS[row.reason] ?? SKIP_LABELS.other}
          </Typography>
          <Typography variant="captionMuted">{row.count}</Typography>
        </Stack>
      ))}
      {mostlySkipped && (
        <Typography variant="caption" color="warning.main">
          Most jobs are being skipped. Lower the min score, or point your searches somewhere else.
        </Typography>
      )}
    </Stack>
  );
}

interface TodayPanelProps {
  state: PilotState;
}

export function TodayPanel(props: TodayPanelProps): ReactElement {
  const { state } = props;
  const { appliedToday, capReached, networkingSentToday } = state;
  const { dailyApplyCap, minScore, networking } = state.instructionsConfig;
  const outreachOn = networkingMode(state.instructionsConfig) !== null;

  return (
    <Stack spacing={2}>
      <Stack spacing={1}>
        <Typography variant="overlineMuted">Today</Typography>
        {dailyApplyCap > 0 ? (
          <Meter label="Applied" value={appliedToday} cap={dailyApplyCap} spent={capReached} />
        ) : (
          <Typography variant="body2Muted">
            Daily apply cap is 0 - the pilot won't apply until you raise it.
          </Typography>
        )}
        {outreachOn && networking.dailyCap > 0 && (
          <Meter
            label="Networked"
            value={networkingSentToday}
            cap={networking.dailyCap}
            spent={networkingSentToday >= networking.dailyCap}
          />
        )}
        <TodayOutcomes appliedToday={appliedToday} />
      </Stack>
      <Grid container spacing={1.5}>
        <Grid size={4}>
          <StatCard label="Min score" value={minScore} />
        </Grid>
        <Grid size={4}>
          <StatCard label="Daily cap" value={dailyApplyCap} />
        </Grid>
        <Grid size={4}>
          <StatCard
            label="Networking"
            value={outreachOn ? networking.dailyCap : "Off"}
            hint={outreachOn ? "per day" : "disabled"}
          />
        </Grid>
      </Grid>
    </Stack>
  );
}
