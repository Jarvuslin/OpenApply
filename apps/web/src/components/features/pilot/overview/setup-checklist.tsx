"use client";

import type { ReactNode } from "react";
import { CheckCircle, RadioButtonUnchecked } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { PilotState } from "@openapply/contracts/pilot";
import { useApiQuery } from "@/api/hooks";
import { emailQueries } from "@/api/queries";
import { LinkButton } from "@/components/ui/buttons";
import { SectionCard } from "@/components/ui/layout";
import { useAgentAvailable, useAgentDock } from "@/providers/agent-provider";
import type { TerminalHealth } from "../../agent-dock/use-terminal-health";
import type { PilotControls } from "../use-pilot-controls";

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  done: boolean;
  action: ReactNode;
}

interface PilotSetupChecklistProps {
  state: PilotState;
  controls: PilotControls;
  health: TerminalHealth;
}

/** Renders nothing once the pilot is fully set up. */
export function PilotSetupChecklist(props: PilotSetupChecklistProps): ReactNode {
  const { state, controls, health } = props;
  const dock = useAgentDock();
  const agentAvailable = useAgentAvailable();

  const mailbox = useApiQuery(emailQueries.account()).data;

  const hostReady = health === "reachable";
  const running = state.running;
  const goalsDone = state.instructionsGoals.trim() !== "";
  const connected = mailbox?.connected === true;
  const needsReauth = connected && mailbox.needsReauth;
  const emailOk = connected && !needsReauth;

  // An unanswered probe counts as done here so the card doesn't flash; the step rows stay strict.
  const hostSettled = hostReady || health === "checking";
  const emailSettled = emailOk || mailbox == null;

  if (hostSettled && running && emailSettled) {
    return null;
  }

  const steps: ChecklistStep[] = [
    {
      id: "host",
      label: "Start the agent host",
      description: "The pilot runs on your machine through the OpenApply terminal.",
      done: hostReady,
      action: agentAvailable ? (
        <Button size="small" variant="outlined" onClick={dock.expand}>
          Open agent dock
        </Button>
      ) : (
        <LinkButton size="small" variant="outlined" href="/install">
          Install the agent
        </LinkButton>
      ),
    },
    {
      id: "goals",
      label: "Write your goals",
      description: "Goals steer the pilot - it creates and re-runs its own searches from them.",
      done: goalsDone,
      action: (
        <LinkButton size="small" variant="outlined" href="/pilot/instructions">
          Write goals
        </LinkButton>
      ),
    },
    {
      id: "email",
      label: needsReauth ? "Reconnect your mailbox" : "Connect your mailbox",
      description: needsReauth
        ? "Google rejected the mailbox's access grant - mail sync, verification codes, and sending are paused."
        : "The pilot reads replies, fetches verification codes, and sends approved interview replies through it.",
      done: emailOk,
      action: (
        <LinkButton size="small" variant="outlined" href="/settings/email">
          {needsReauth ? "Reconnect" : "Connect Gmail"}
        </LinkButton>
      ),
    },
    {
      id: "start",
      label: "Start the pilot",
      description: "Turns on autonomous cycles on your own Claude or Codex subscription.",
      done: running,
      action: (
        <Button
          size="small"
          variant="contained"
          disabled={controls.isLoading || !hostReady || !goalsDone}
          onClick={() => void controls.start()}
        >
          Start
        </Button>
      ),
    },
  ];

  return (
    <SectionCard
      title="Set up the pilot"
      description="Install the agent and start the pilot - it handles the rest."
    >
      <Stack spacing={2}>
        {steps.map((step) => (
          <Stack key={step.id} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            {step.done ? (
              <CheckCircle fontSize="small" sx={{ color: "success.main" }} />
            ) : (
              <RadioButtonUnchecked fontSize="small" sx={{ color: "text.disabled" }} />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1Strong">{step.label}</Typography>
              <Typography variant="captionMuted">{step.description}</Typography>
            </Box>
            {!step.done && step.action}
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}
