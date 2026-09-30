"use client";

import type { ReactElement } from "react";
import { Box, Skeleton, Stack } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { useTerminalHealth } from "../../agent-dock/use-terminal-health";
import { NeedsAttention } from "../attention/needs-attention";
import { usePilotControls } from "../use-pilot-controls";
import { AgendaPreview } from "./agenda-preview";
import { OrchestrationPanel } from "./orchestration-panel";
import { RecentActivity } from "./recent-activity";
import { PilotSetupChecklist } from "./setup-checklist";
import { StatusHero } from "./status-hero";

export function OverviewTab(): ReactElement {
  // Owned here so the hero, checklist and diagram share one host poll.
  const controls = usePilotControls();
  const { health, status } = useTerminalHealth(controls.isLoading);
  const stateQuery = useApiQuery(pilotQueries.state(), {
    errorMessage: "Failed to load pilot state",
  });

  const state = stateQuery.data;
  if (stateQuery.isLoading || !state) {
    return (
      <Stack spacing={3}>
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={140} />
      </Stack>
    );
  }

  const pilot = status?.pilot ?? null;

  // On xs, Needs attention hoists above the hero so it's reachable one-handed. Sibling margins
  // would break under `order`, hence useFlexGap.
  return (
    <Stack spacing={3} useFlexGap>
      <PilotSetupChecklist state={state} controls={controls} health={health} />
      <Box sx={{ order: { xs: 2, md: 0 } }}>
        <StatusHero state={state} controls={controls} health={health} pilot={pilot} />
      </Box>
      <Box sx={{ order: { xs: 3, md: 0 } }}>
        <OrchestrationPanel state={state} health={health} pilot={pilot} />
      </Box>
      <Box sx={{ order: { xs: 1, md: 0 } }}>
        <NeedsAttention />
      </Box>
      <Box sx={{ order: { xs: 4, md: 0 } }}>
        <AgendaPreview />
      </Box>
      <Box sx={{ order: { xs: 5, md: 0 } }}>
        <RecentActivity />
      </Box>
    </Stack>
  );
}
