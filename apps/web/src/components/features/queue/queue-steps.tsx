"use client";

import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type { WorkState } from "@openapply/contracts/work-queue";
import { Check, X } from "lucide-react";

const STEPS = [
  "Prepare resume and answers",
  "Open the application",
  "Fill the form",
  "Submit",
] as const;

type StepTone = "done" | "current" | "failed" | "todo";

/** Which step the run is on; -1 before it starts and 4 once everything is done. */
function currentStep(state: WorkState, started: boolean): number {
  if (state === "preparing") return 0;
  if (state === "ready") return 1;
  if (state === "filling" || state === "needs_user" || state === "stopping") return 2;
  if (state === "submitted" || state === "completed") return STEPS.length;
  return started ? 2 : -1;
}

function currentLabel(state: WorkState, step: string): string {
  if (state === "needs_user") return "Waiting for your answer";
  if (state === "paused") return `Paused at: ${step.toLowerCase()}`;
  if (state === "failed" || state === "cancelled" || state === "stopping")
    return `Stopped at: ${step.toLowerCase()}`;
  return step;
}

interface QueueStepsProps {
  state: WorkState;
  started: boolean;
}

export function QueueSteps({ state, started }: QueueStepsProps): ReactElement {
  const at = currentStep(state, started);
  return (
    <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0, listStyle: "none" }}>
      {STEPS.map((step, index) => {
        let tone: StepTone = "todo";
        if (index < at) tone = "done";
        else if (index === at) tone = state === "failed" ? "failed" : "current";
        return (
          <Stack
            key={step}
            component="li"
            direction="row"
            spacing={1.25}
            sx={{ alignItems: "center" }}
          >
            <StepMark tone={tone} />
            <Typography
              variant={tone === "current" ? "body2Strong" : "body2"}
              color={tone === "todo" ? "text.disabled" : "text.primary"}
            >
              {index === at ? currentLabel(state, step) : step}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

interface StepMarkProps {
  tone: StepTone;
}

function StepMark({ tone }: StepMarkProps): ReactElement {
  const base = {
    width: 16,
    height: 16,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  } as const;
  if (tone === "done")
    return (
      <Box sx={{ ...base, border: 1.5, borderColor: "statusDots.done", color: "statusDots.done" }}>
        <Check size={10} strokeWidth={3} aria-hidden />
      </Box>
    );
  if (tone === "failed")
    return (
      <Box sx={{ ...base, bgcolor: "statusDots.failed", color: "background.paper" }}>
        <X size={10} strokeWidth={3} aria-hidden />
      </Box>
    );
  if (tone === "current")
    return (
      <Box sx={base}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "statusDots.active" }} />
      </Box>
    );
  return <Box sx={{ ...base, border: 1.5, borderColor: "line.borderHi" }} />;
}
