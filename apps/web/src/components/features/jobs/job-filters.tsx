"use client";

import { type ReactElement, type SubmitEvent, useRef } from "react";
import {
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  Typography,
} from "@mui/material";
import {
  JOB_LEVEL_LABELS,
  JOB_LEVELS,
  parseTechParam,
  serializeTechParam,
} from "@openapply/contracts/job-listing";
import { useRouter, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/ui/form";
import { ActiveFilters } from "./active-filters";
import { jobsHref } from "./jobs-href";

interface JobFiltersProps {
  /** The skills the index actually contains, most common first. */
  skillOptions: string[];
}

/**
 * Filters navigate to a real `/jobs?q=…` URL rather than holding client state, so results stay
 * shareable and crawlable.
 */
export function JobFilters(props: JobFiltersProps): ReactElement {
  const { skillOptions } = props;
  const router = useRouter();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);

  const remote = params.get("remote") === "true";
  // The public param stays `?tech=` so links shared before the skills rename keep working.
  const skills = parseTechParam(params.get("tech"));

  /**
   * Seeds the query from the live form, then applies the patch (`null` drops a key). Reading the
   * form - not just `params` - is what keeps text the user typed but has not submitted when they
   * toggle Remote or pick a skill.
   */
  const apply = (patch: Record<string, string | null> = {}): void => {
    const next = new URLSearchParams(params);
    const data = form.current ? new FormData(form.current) : null;

    for (const key of ["q", "location", "level", "maxYears"] as const) {
      patch[key] ??= String(data?.get(key) ?? "").trim() || null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    router.push(jobsHref(next));
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    apply();
  };

  return (
    <Card sx={{ p: 2 }}>
      <Box component="form" ref={form} onSubmit={onSubmit}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            sx={{ alignItems: { xs: "stretch", md: "center" } }}
          >
            <TextField
              name="q"
              placeholder="Title or company"
              defaultValue={params.get("q") ?? ""}
              sx={{ flex: 1 }}
            />
            <TextField
              name="location"
              placeholder="Location"
              defaultValue={params.get("location") ?? ""}
              sx={{ flex: 1 }}
            />
            <MultiSelect
              value={skills}
              onChange={(values) =>
                apply({ tech: values.length > 0 ? serializeTechParam(values) : null })
              }
              options={skillOptions}
              freeSolo={false}
              placeholder={skills.length > 0 ? undefined : "Skills"}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <ToggleButton
                value="remote"
                selected={remote}
                onChange={() => apply({ remote: remote ? null : "true" })}
                sx={{ flex: { xs: 1, md: "none" } }}
              >
                Remote
              </ToggleButton>
              <Button type="submit" variant="contained" sx={{ flex: { xs: 1, md: "none" } }}>
                Search
              </Button>
            </Stack>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              name="level"
              label="Job level"
              select
              defaultValue={params.get("level") ?? ""}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Any level</MenuItem>
              {JOB_LEVELS.map((value) => (
                <MenuItem key={value} value={value}>
                  {JOB_LEVEL_LABELS[value]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              name="maxYears"
              label="Max. required years"
              type="number"
              defaultValue={params.get("maxYears") ?? ""}
              slotProps={{ htmlInput: { min: 0, max: 50, step: 1 } }}
            />
          </Stack>
          <Typography variant="captionMuted">
            Levels are inferred from titles. A years filter excludes unspecified experience.
          </Typography>
          <ActiveFilters />
        </Stack>
      </Box>
    </Card>
  );
}
