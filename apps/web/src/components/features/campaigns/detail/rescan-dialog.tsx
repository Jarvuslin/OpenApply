"use client";

import { type ReactElement, useState } from "react";
import { Button, Slider, Typography } from "@mui/material";
import { FormDialogShell } from "@/components/ui/form";
import { plural } from "@/utils/format";

interface RescanDialogProps {
  open: boolean;
  onClose: () => void;
  skippedCount: number;
  defaultMinScore: number;
  pending: boolean;
  onConfirm: (minScore: number) => void;
}

/** Reconsiders skipped jobs without rerating unchanged evidence to meet a lower minimum. */
export function RescanDialog(props: RescanDialogProps): ReactElement {
  const { open, onClose, skippedCount, defaultMinScore, pending, onConfirm } = props;
  const [minScore, setMinScore] = useState(defaultMinScore);

  return (
    <FormDialogShell
      open={open}
      title="Rescan skipped jobs"
      maxWidth="xs"
      onClose={onClose}
      onSubmit={() => onConfirm(minScore)}
      submit={
        <Button type="submit" variant="contained" disabled={pending}>
          Rescan
        </Button>
      }
    >
      <Typography variant="body2Muted">
        Reviews the {plural(skippedCount, "skipped job")} using this minimum and sets eligible ones
        to <strong>approved</strong>. Scores stay unchanged unless the source evidence changes.
        Apply approved jobs from the jobs list or with Re-apply selected.
      </Typography>
      <Typography variant="body2">Your minimum score for applying: {minScore}</Typography>
      <Slider
        value={minScore}
        min={0}
        max={100}
        step={1}
        marks
        valueLabelDisplay="auto"
        onChange={(_, v) => setMinScore(v as number)}
      />
    </FormDialogShell>
  );
}
