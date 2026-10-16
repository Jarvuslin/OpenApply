"use client";

import type { ReactElement } from "react";
import { Grid } from "@mui/material";
import type { AnalyticsStatsDto } from "@/api/types";
import { StatCard } from "@/components/ui/display";

interface DashboardMetricsProps {
  stats: AnalyticsStatsDto;
}

function weekChange(thisWeek: number, lastWeek: number): string {
  const change = thisWeek - lastWeek;
  if (change > 0) return `↑ ${change} vs last week`;
  if (change < 0) return `↓ ${-change} vs last week`;
  return "Same as last week";
}

/** This month's total, real employer results, time the agent saved and the weekly pace. */
export function DashboardMetrics({ stats }: DashboardMetricsProps): ReactElement {
  const { agent } = stats;
  const appliedThisMonth = stats.perDay.reduce((n, day) => n + day.count, 0);
  const month = stats.perDay[0]
    ? new Date(stats.perDay[0].date).toLocaleDateString(undefined, {
        month: "long",
        timeZone: "UTC",
      })
    : "";
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Applied this month"
          value={appliedThisMonth}
          hint={month}
          hintTone="positive"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Response rate"
          value={`${stats.responseRatePct}%`}
          hint={`${stats.responses} of ${stats.totals.applications} replied`}
          hintTone="positive"
          definition="Share of applications with a real result: a rejection, screening, interview or offer. Thank-you emails and silence don't count."
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="Time saved"
          value={`${agent.minutesSaved} min`}
          hint={`${agent.submitted} ${agent.submitted === 1 ? "application" : "applications"} × ~10 min`}
          hintTone="positive"
          definition="Time you'd have spent filling forms yourself, at about 10 minutes per application the agent submitted."
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          label="This week"
          value={stats.thisWeek.submitted}
          hint={weekChange(stats.thisWeek.submitted, stats.lastWeek.submitted)}
          hintTone={stats.thisWeek.submitted >= stats.lastWeek.submitted ? "positive" : "muted"}
          definition="Applications sent in the last 7 days, compared with the 7 days before."
        />
      </Grid>
    </Grid>
  );
}
