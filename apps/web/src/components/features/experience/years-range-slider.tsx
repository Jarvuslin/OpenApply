"use client";

import { type ReactElement, useState } from "react";
import { Slider, Stack, Typography } from "@mui/material";
import { yearsLabel } from "./experience-labels";

const YEARS_MAX = 10;
const MARKS = [0, 2, 4, 6, 8, 10].map((value) => ({
  value,
  label: value === YEARS_MAX ? "10+" : String(value),
}));

interface YearsRangeSliderProps {
  label: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}

/** The years of experience a job asks for. The ends of the track mean "no limit". */
export function YearsRangeSlider(props: YearsRangeSliderProps): ReactElement {
  const { label, min, max, onChange } = props;
  // Searching runs when a handle is let go, not on every step of a drag.
  const [dragging, setDragging] = useState<number[] | null>(null);
  const [low = 0, high = YEARS_MAX] = dragging ?? [min ?? 0, max ?? YEARS_MAX];
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2Muted">
        {yearsLabel(low === 0 ? null : low, high === YEARS_MAX ? null : high)}
      </Typography>
      <Slider
        value={[low, high]}
        onChange={(_, value) => setDragging(value as number[])}
        onChangeCommitted={(_, value) => {
          const [from = 0, to = YEARS_MAX] = value as number[];
          setDragging(null);
          onChange(from === 0 ? null : from, to === YEARS_MAX ? null : to);
        }}
        min={0}
        max={YEARS_MAX}
        step={1}
        marks={MARKS}
        disableSwap
        valueLabelDisplay="auto"
        valueLabelFormat={(value) => (value === YEARS_MAX ? "10+" : String(value))}
        getAriaLabel={(index) => (index === 0 ? `${label} minimum` : `${label} maximum`)}
        sx={{ mx: 1, width: "auto" }}
      />
    </Stack>
  );
}
