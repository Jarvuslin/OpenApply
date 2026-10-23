"use client";

import type { ReactElement } from "react";
import { Chip, Stack } from "@mui/material";

// Each funnel bucket is exactly one status (its `key`); rejected/withdrawn have no bucket.
export const FUNNEL_GROUPS = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
] as const;

export type FunnelKey = (typeof FUNNEL_GROUPS)[number]["key"];

interface FunnelBarProps {
  counts: Record<FunnelKey, number>;
  selected: FunnelKey | null;
  onSelect: (key: FunnelKey | null) => void;
}

export function FunnelBar(props: FunnelBarProps): ReactElement {
  const { counts, selected, onSelect } = props;

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
      {FUNNEL_GROUPS.map((group) => {
        const active = selected === group.key;
        const toggle = (): void => onSelect(active ? null : group.key);
        return (
          // A filter, not a stat card: the Dashboard holds the analytics.
          <Chip
            key={group.key}
            label={`${group.label} · ${counts[group.key]}`}
            variant={active ? "filled" : "outlined"}
            color={active ? "primary" : "default"}
            aria-pressed={active}
            onClick={toggle}
          />
        );
      })}
    </Stack>
  );
}
