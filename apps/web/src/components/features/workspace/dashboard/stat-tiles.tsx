"use client";

import type { ReactElement } from "react";
import { Grid } from "@mui/material";
import { INTERVIEW_STATUSES } from "@openapply/contracts/application";
import { useApiQuery } from "@/api/hooks";
import { applicationQueries, campaignQueries } from "@/api/queries";
import { StatCard } from "@/components/ui/display";

export function StatTiles(): ReactElement {
  const campaigns = useApiQuery(campaignQueries.list());
  // Counts come from the server aggregate, not a loaded page - these are whole-account totals.
  const applications = useApiQuery(applicationQueries.summary());

  const rows = campaigns.data?.items ?? [];
  const byStatus = applications.data?.byStatus;

  const active = rows.filter((c) => c.status === "in_progress" || c.status === "paused").length;
  const interviewing = INTERVIEW_STATUSES.reduce((n, s) => n + (byStatus?.[s] ?? 0), 0);

  return (
    <Grid container spacing={1.5}>
      <Grid size={{ xs: 6, md: 4 }}>
        <StatCard label="Active campaigns" value={active} hint="running or paused" />
      </Grid>
      <Grid size={{ xs: 6, md: 4 }}>
        <StatCard label="Applied" value={applications.data?.total ?? 0} hint="all time" />
      </Grid>
      <Grid size={{ xs: 6, md: 4 }}>
        <StatCard label="Interviewing" value={interviewing} hint="past the first reply" />
      </Grid>
    </Grid>
  );
}
