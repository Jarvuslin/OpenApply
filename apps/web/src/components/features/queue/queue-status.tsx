"use client";

import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type { WorkState } from "@openapply/contracts/work-queue";
import { QUEUE_STATE_LABELS, QUEUE_STATE_TONES, type QueueTone } from "./queue-state";

interface QueueStatusProps {
  state: WorkState;
}

/** Live worker status: a colored dot beside neutral text. */
export function QueueStatus({ state }: QueueStatusProps): ReactElement {
  return <StatusDot tone={QUEUE_STATE_TONES[state]} label={QUEUE_STATE_LABELS[state]} />;
}

interface StatusDotProps {
  tone: QueueTone;
  label: string;
}

function StatusDot({ tone, label }: StatusDotProps): ReactElement {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: `statusDots.${tone}`,
        }}
      />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </Stack>
  );
}

interface FitMeterProps {
  score: number | null;
}

function fitColor(score: number): string {
  if (score >= 80) return "statusBorders.success";
  if (score >= 60) return "statusBorders.info";
  return "line.borderHi";
}

export function FitMeter({ score }: FitMeterProps): ReactElement {
  if (score === null)
    return (
      <Typography variant="captionMuted" title="Not scored yet">
        —
      </Typography>
    );
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
      <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: "surfaces.hover" }}>
        <Box
          sx={{
            width: `${Math.min(100, Math.max(0, score))}%`,
            height: 1,
            borderRadius: 2,
            bgcolor: fitColor(score),
          }}
        />
      </Box>
      <Typography variant="body2">{score}%</Typography>
    </Stack>
  );
}
