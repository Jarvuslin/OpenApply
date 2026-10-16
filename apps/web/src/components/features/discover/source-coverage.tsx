"use client";

import { type ReactElement, useState } from "react";
import { ExpandMore, Refresh } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { discoverQueries } from "@/api/discover-queries";
import { apiErrorMessage } from "@/api/error";
import { useApiQuery } from "@/api/hooks";

const STATUS_LABELS = {
  connected: "Connected",
  needs_setup: "Setup needed",
  unavailable: "Not connected",
  error: "Temporarily unavailable",
  pending: "First refresh pending",
};

export function SourceCoverage(): ReactElement {
  const queryClient = useQueryClient();
  const coverage = useApiQuery(discoverQueries.coverage(), {
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connected =
    coverage.data?.sources.filter((source) => source.status === "connected").length ?? 0;
  let summary = "Checking source availability…";
  if (coverage.error) summary = "Source status unavailable";
  if (coverage.data) summary = `${connected} sources connected · automatic feed updates`;
  if (coverage.data?.refreshing) summary = "Checking job sources…";

  async function refresh(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await api["job-sources"].refresh.post();
      if (result.error) throw new Error(apiErrorMessage(result.error));
      setMessage(
        result.data.scheduled
          ? "Checking sources in the background. New arrivals will appear in Jobs."
          : "Sources were checked recently. Automatic updates are running on schedule.",
      );
      await queryClient.invalidateQueries({ queryKey: ["discover-sources"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh sources.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="captionMuted" sx={{ mr: "auto" }}>
          {summary}
        </Typography>
        <Button size="small" startIcon={<Refresh />} loading={busy} onClick={() => void refresh()}>
          Check for new jobs
        </Button>
      </Stack>
      <Accordion
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: "divider", "&:before": { display: "none" } }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="body2">Sources and freshness</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Typography variant="captionMuted">
              Employer feeds update automatically. Other boards need a provider connection or an
              on-demand search. Coverage is limited to the connected sources.
            </Typography>
            {coverage.data?.lastUpdatedAt && (
              <Typography variant="captionMuted">
                Last successful import: {new Date(coverage.data.lastUpdatedAt).toLocaleString()}
              </Typography>
            )}
            {coverage.data?.sources.map((source) => (
              <Stack
                key={source.id}
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Stack spacing={0.5} sx={{ flex: 1 }}>
                  <Typography variant="body2Strong">{source.name}</Typography>
                  <Typography variant="captionMuted">{source.details}</Typography>
                </Stack>
                <Chip
                  size="small"
                  color={source.status === "connected" ? "success" : "default"}
                  label={STATUS_LABELS[source.status]}
                />
                {source.status === "needs_setup" && (
                  <Link href="/settings/connections" variant="body2">
                    Set up
                  </Link>
                )}
              </Stack>
            ))}
            {coverage.error && (
              <Alert severity="warning">
                Could not check source availability.{" "}
                <Button onClick={() => void coverage.refetch()}>Retry</Button>
              </Alert>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
      {message && (
        <Alert severity="info" onClose={() => setMessage("")}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
