"use client";

import type { ReactElement } from "react";
import { Stack } from "@mui/material";
import { AnalyticsView } from "@/components/features/analytics/analytics-view";
import { NowRunning } from "./dashboard/now-running";
import { ProfileChecklistCard } from "./dashboard/profile-checklist-card";

export function OverviewPanel(): ReactElement {
  return (
    <Stack spacing={2}>
      <ProfileChecklistCard />
      <AnalyticsView searches={<NowRunning />} />
    </Stack>
  );
}
