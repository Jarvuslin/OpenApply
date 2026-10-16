"use client";

import type { ReactElement } from "react";
import { Alert, Box, Card, Stack, Typography } from "@mui/material";
import { keepPreviousData } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Clock,
  Info,
  Laptop,
  MapPin,
  RefreshCw,
  Search,
  SignalHigh,
  Target,
} from "lucide-react";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/pilot-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { PilotFormValues } from "./pilot-form";
import {
  COMPANY_TYPE_OPTIONS,
  experienceLabel,
  intervalLabel,
  WINDOW_OPTIONS,
  WORK_MODE_OPTIONS,
} from "./pilot-format";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

const NEXT_STEP = [
  [
    "Next step: Refine your filters",
    "Add keywords, companies to include or skip, and how recent jobs should be.",
  ],
  ["Next step: Set the match bar", "Choose the minimum fit and which resume to score against."],
  ["Next step: Choose a schedule", "Run on a timer, or only when you press Run now."],
  ["Next step: Review", "Check everything once before creating the pilot."],
] as const;

interface PilotSummaryProps {
  values: PilotFormValues;
  step: number;
  resumes: { id: string; label: string }[];
}

function labels<T extends string>(list: T[], options: readonly { value: T; label: string }[]) {
  return list.map((item) => options.find((option) => option.value === item)?.label ?? item);
}

/** What the pilot will do, growing a line as each step is finished. */
export function PilotSummary({ values, step, resumes }: PilotSummaryProps): ReactElement {
  const { rules } = values;
  // Each chip click changes the rules; wait for a pause so the count isn't refetched per click.
  const settledRules = useDebouncedValue(rules, 400);
  const preview = useApiQuery(pilotQueries.preview(settledRules), {
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const lines = [
    { icon: <Search {...ICON} />, text: values.name || "Untitled pilot", from: 0 },
    { icon: <Briefcase {...ICON} />, text: rules.roles.join(", ") || "Any role", from: 0 },
    {
      icon: <SignalHigh {...ICON} />,
      text: experienceLabel(rules),
      from: 0,
    },
    {
      icon: <Building2 {...ICON} />,
      text: labels(rules.companyTypes, COMPANY_TYPE_OPTIONS).join(", ") || "Any company type",
      from: 0,
    },
    { icon: <MapPin {...ICON} />, text: rules.locations.join(", ") || "Anywhere", from: 0 },
    {
      icon: <Laptop {...ICON} />,
      text: labels(rules.workModes, WORK_MODE_OPTIONS).join(", ") || "Any work mode",
      from: 0,
    },
    {
      icon: <Clock {...ICON} />,
      text: [
        rules.postedWithin.length
          ? `Posted in ${rules.postedWithin
              .map((value) => WINDOW_OPTIONS.find((option) => option.value === value)?.short)
              .join(", ")}`
          : "Posted any time",
        rules.keywords.length ? `keywords: ${rules.keywords.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      from: 1,
    },
    {
      icon: <Target {...ICON} />,
      text: `${values.minScore}%+ fit · ${resumes.find((resume) => resume.id === values.resumeId)?.label ?? "no resume"}`,
      from: 2,
    },
    {
      icon: <RefreshCw {...ICON} />,
      text: values.autoRun
        ? `${intervalLabel(values.intervalMinutes)} · ${values.mode === "queue" ? "adds to queue" : "holds for review"} · up to ${values.maxJobsPerRun}`
        : `Run now only · up to ${values.maxJobsPerRun} jobs`,
      from: 3,
    },
  ];
  const next = NEXT_STEP[step];
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2.5 }}>
        <Stack spacing={1.75}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Info {...ICON} />
            <Typography variant="h4" component="h2">
              Summary
            </Typography>
          </Stack>
          {lines
            .filter((line) => line.from <= step)
            .map((line) => (
              <Stack key={line.text + line.from} direction="row" spacing={1.25}>
                <Box sx={{ display: "flex", color: "text.secondary", pt: 0.25 }}>{line.icon}</Box>
                <Typography variant="body2">{line.text}</Typography>
              </Stack>
            ))}
          {preview.data && (
            <Box sx={{ pt: 1.5, borderTop: 1, borderColor: "divider" }}>
              <Typography variant="captionMuted">Matching right now, before scoring</Typography>
              {preview.data.windows.map((window) => (
                <Stack
                  key={String(window.minutes)}
                  direction="row"
                  sx={{ justifyContent: "space-between" }}
                >
                  <Typography variant="body2Muted">
                    {window.minutes === null
                      ? "Any time"
                      : WINDOW_OPTIONS.find((option) => option.value === window.minutes)?.label}
                  </Typography>
                  <Typography variant="body2Strong">{window.count} jobs</Typography>
                </Stack>
              ))}
            </Box>
          )}
        </Stack>
      </Card>
      {next && (
        <Alert severity="info" icon={<Info {...ICON} />}>
          <Typography variant="body2Strong">{next[0]}</Typography>
          <Typography variant="body2Muted">{next[1]}</Typography>
        </Alert>
      )}
    </Stack>
  );
}
