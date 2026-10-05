"use client";
import { Alert, Chip, Stack, Typography } from "@mui/material";
import { useTerminalHealth } from "../agent-dock/use-terminal-health";

export function RuntimeStatus() {
  const { status, health } = useTerminalHealth();
  const runtime = status?.runtime;
  if (!runtime || health !== "reachable") {
    return (
      <Alert severity="info">
        Start the local agent to detect your machine and browser runtime.
      </Alert>
    );
  }
  const platform = runtime.platform === "macos" ? "Mac" : runtime.platform;
  return (
    <Stack spacing={1}>
      <Typography variant="h3">Your machine</Typography>
      <Stack direction="row" spacing={1}>
        <Chip label={`${platform} · ${runtime.architecture}`} variant="outlined" />
        <Chip label={`Browser runtime · ${runtime.backend.toUpperCase()}`} variant="outlined" />
      </Stack>
      {runtime.support === "beta-unvalidated" && (
        <Alert severity="warning">
          Mac beta: setup is implemented; a complete workflow on a real Mac is still awaiting
          validation.
        </Alert>
      )}
      {runtime.support === "unsupported" && (
        <Alert severity="error">
          This machine does not have a supported OpenApply browser runtime.
        </Alert>
      )}
    </Stack>
  );
}
