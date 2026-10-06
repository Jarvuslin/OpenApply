"use client";

import type { ReactElement } from "react";
import { Alert, Box, Button, Chip, Grid, Stack, Tooltip, Typography } from "@mui/material";
import type { PilotState } from "@openapply/contracts/pilot";
import { ColorChip, RelativeTime } from "@/components/ui/display";
import { SectionCard } from "@/components/ui/layout";
import { CYCLE_STATUS_COLOR, type PilotHealth, providerDisplayName } from "@/lib/terminal";
import { useConfirm } from "@/providers/confirm-provider";
import { formatTimeUntil, plural } from "@/utils/format";
import type { TerminalHealth } from "../../agent-dock/use-terminal-health";
import { isHostOffline, PILOT_HOST_OFFLINE_MESSAGE, PILOT_STARTING_UP_LABEL } from "../host-status";
import type { PilotControls } from "../use-pilot-controls";
import { TodayPanel } from "./today-panel";
import { useNextWake } from "./use-next-wake";

interface StatusHeroProps {
  state: PilotState;
  controls: PilotControls;
  health: TerminalHealth;
  pilot: PilotHealth | null;
}

export function StatusHero(props: StatusHeroProps): ReactElement {
  const { state, controls, health, pilot } = props;
  const confirm = useConfirm();
  const nextWakeAt = useNextWake();

  const running = state.running;
  const conducting = pilot?.conducting ?? false;
  const goalsEmpty = state.instructionsGoals.trim() === "";
  const timeouts = pilot?.consecutiveTimeouts ?? 0;

  const stopWithConfirm = async (): Promise<void> => {
    const ok = await confirm({
      title: "Stop the pilot?",
      description: "The pilot stops running cycles: no applying until you start it again.",
      confirmLabel: "Stop",
      destructive: true,
    });
    if (ok) {
      await controls.stop();
    }
  };

  return (
    <SectionCard
      title="Pilot"
      description="Autonomous mode runs cycles on your local agent using these instructions."
      actions={
        running ? (
          <Button
            color="error"
            variant="outlined"
            disabled={controls.isLoading}
            onClick={() => void stopWithConfirm()}
          >
            Stop
          </Button>
        ) : (
          // A disabled button emits no pointer events, so the tooltip needs an enabled span to hover over.
          <Tooltip title={goalsEmpty ? "Write the pilot's goals before starting it." : ""}>
            <Box component="span" sx={{ display: "inline-flex" }}>
              <Button
                variant="contained"
                disabled={controls.isLoading || health !== "reachable" || goalsEmpty}
                onClick={() => void controls.start()}
              >
                Start
              </Button>
            </Box>
          </Tooltip>
        )
      }
    >
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Chip
                color={running ? "success" : "default"}
                label={running ? "Running" : "Stopped"}
                size="small"
              />
              <Chip
                variant="outlined"
                color={pilot?.paired ? "primary" : "default"}
                label={pilot?.paired ? "Agent connected" : "Agent not connected"}
                size="small"
              />
              {conducting && <Chip color="info" label="Working" size="small" />}
              {running && state.cycleCount === 0 && !conducting && (
                <Chip
                  color="info"
                  variant="outlined"
                  label={PILOT_STARTING_UP_LABEL}
                  size="small"
                />
              )}
              {timeouts > 0 && (
                <Chip
                  color="warning"
                  variant="outlined"
                  label={plural(timeouts, "timeout")}
                  size="small"
                />
              )}
            </Stack>

            {/* Stopped + offline is the setup checklist's job; only warn when cycles should run. */}
            {running && isHostOffline(health) && (
              <Alert severity="warning">{PILOT_HOST_OFFLINE_MESSAGE}</Alert>
            )}

            <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap", gap: 2 }}>
              <Box>
                <Typography variant="overlineMuted">Provider</Typography>
                <Typography variant="body2">{providerDisplayName(controls.provider)}</Typography>
              </Box>
              <Box>
                <Typography variant="overlineMuted">Cycles run</Typography>
                <Typography variant="body2">{state.cycleCount}</Typography>
              </Box>
              <Box>
                <Typography variant="overlineMuted">Last cycle</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {state.lastCycleAt ? (
                    <RelativeTime value={state.lastCycleAt} variant="body2" />
                  ) : (
                    <Typography variant="body2">-</Typography>
                  )}
                  {pilot?.lastCycleStatus && (
                    <ColorChip
                      value={pilot.lastCycleStatus}
                      colors={CYCLE_STATUS_COLOR}
                      variant="filled"
                      size="small"
                    />
                  )}
                </Stack>
              </Box>
              {/* Hidden mid-cycle: the "Working" chip already covers that state. */}
              {running && nextWakeAt && !conducting && (
                <Box>
                  <Typography variant="overlineMuted">Next wake</Typography>
                  <Typography variant="body2">
                    {nextWakeAt.getTime() <= Date.now()
                      ? "due now"
                      : `in ${formatTimeUntil(nextWakeAt)}`}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <TodayPanel state={state} />
        </Grid>
      </Grid>
    </SectionCard>
  );
}
