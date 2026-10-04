"use client";

import type { ReactNode } from "react";
import { Button, Chip, Stack } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { jobsHref } from "./jobs-href";

/** Chipped one-by-one; `tech` is absent because the multi-select above already renders it as chips. */
const CHIPPED = ["q", "location", "board", "remote", "level", "maxYears"] as const;

/** The applied filters as removable chips, plus the only "clear everything" affordance. */
export function ActiveFilters(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();

  const applied = CHIPPED.filter((key) => params.get(key)).map((key) => ({
    key,
    // `?remote=true` reads as a state, not a value.
    label: key === "remote" ? "Remote" : `${key}: ${params.get(key)}`,
  }));

  const dirty = [...params.keys()].some((key) => key !== "page");
  if (!dirty) {
    return null;
  }

  const drop = (key: string): void => {
    const next = new URLSearchParams(params);
    next.delete(key);
    router.push(jobsHref(next));
  };

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
      {applied.map((filter) => (
        <Chip
          key={filter.key}
          label={filter.label}
          size="small"
          variant="outlined"
          onDelete={() => drop(filter.key)}
        />
      ))}
      <Button variant="text" size="small" onClick={() => router.push("/jobs")}>
        Clear all
      </Button>
    </Stack>
  );
}
