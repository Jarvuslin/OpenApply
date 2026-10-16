import type { ReactElement } from "react";
import { Alert, Chip, Stack, Typography } from "@mui/material";
import type { linkedinSettingsSchema } from "@openapply/contracts/linkedin-discovery";
import type { z } from "zod/v4";

interface LinkedinDiscoveryStatusProps {
  settings: z.infer<typeof linkedinSettingsSchema>;
}

function time(value: Date | null, empty: string): string {
  return value ? new Date(value).toLocaleString() : empty;
}

export function LinkedinDiscoveryStatus(props: LinkedinDiscoveryStatusProps): ReactElement {
  const { settings } = props;
  const backingOff =
    !!settings.backoffUntil && new Date(settings.backoffUntil).getTime() > Date.now();
  let nextRun = "Off";
  if (settings.enabled)
    nextRun = time(settings.nextRunAt, "Eligible when your local collector next runs");
  let status = "Never run";
  if (settings.lastRunStatus === "claimed") status = "Waiting for collector";
  if (settings.lastRunStatus === "processing") status = "Processing results";
  if (settings.lastRunStatus === "completed") status = "Completed";

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip
          label={settings.enabled ? "Enabled" : "Off"}
          size="small"
          color={settings.enabled ? "success" : "default"}
        />
        <Chip label="At most once per 24 hours" size="small" variant="outlined" />
        <Chip label={status} size="small" variant="outlined" />
      </Stack>
      <Typography variant="body2Muted">Next eligible run: {nextRun}</Typography>
      <Typography variant="body2Muted">
        Last run: {time(settings.lastRunAt, "Never")}. Last completed:{" "}
        {time(settings.lastCompletedAt, "Never")}.
      </Typography>
      {backingOff && (
        <Alert severity="warning">
          Requests are paused until {time(settings.backoffUntil, "later")} after a blocked or
          unsuccessful response.
        </Alert>
      )}
      {settings.lastResult && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {[
            ["Fetched", settings.lastResult.fetched],
            ["Pages", settings.lastResult.pagesFetched],
            ["Imported", settings.lastResult.imported],
            ["Employer links", settings.lastResult.resolved],
            ["Filtered out", settings.lastResult.filtered],
            ["Unresolved", settings.lastResult.unresolved],
          ].map(([label, count]) => (
            <Chip key={label} label={`${label}: ${count}`} size="small" variant="outlined" />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
