"use client";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useTerminalHealth } from "@/components/features/agent-dock/use-terminal-health";
import { PluginInstallCommands } from "@/components/features/install";
import { TerminalPanel } from "@/components/features/terminal/terminal-panel";
import { providerDisplayName, runInference } from "@/lib/terminal";
import { useAgentAvailable, useAgentDock } from "@/providers/agent-provider";
import type { ProviderConnection } from "./agent-connection-status";

interface AgentSetupStepProps {
  connection: ProviderConnection | null;
  onConnectionChange: (connection: ProviderConnection | null) => void;
}

export function AgentSetupStep({ connection, onConnectionChange }: AgentSetupStepProps) {
  const { health, recheck } = useTerminalHealth();
  const dock = useAgentDock();
  const desktop = useAgentAvailable();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const verified = connection?.state === "connected" ? connection.provider : null;
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const pendingCheck = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (pendingCheck.current) {
        pendingCheck.current.abort();
        onConnectionChange(null);
      }
    },
    [onConnectionChange],
  );
  const cancelCheck = () => {
    pendingCheck.current?.abort();
    pendingCheck.current = null;
    setBusy(false);
    setCancelled(true);
    onConnectionChange(null);
  };
  const check = async () => {
    if (pendingCheck.current) return;
    const controller = new AbortController();
    pendingCheck.current = controller;
    setBusy(true);
    setCancelled(false);
    setError("");
    onConnectionChange({ provider: dock.provider, state: "verifying" });
    try {
      const result = await runInference(
        dock.provider,
        undefined,
        "haiku",
        undefined,
        controller.signal,
      );
      if (pendingCheck.current === controller && !controller.signal.aborted)
        onConnectionChange({ provider: result.provider, state: "connected" });
    } catch (reason) {
      if (pendingCheck.current === controller && !controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Could not verify the connection");
        onConnectionChange(null);
      }
    } finally {
      if (pendingCheck.current === controller) {
        pendingCheck.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="h4">Connect your agent</Typography>
        <Typography color="text.secondary">
          OpenApply stays in your browser. The companion on your computer runs Claude Code or Codex
          using your own account. You sign in directly with the provider.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Install the OpenApply companion and the CLI for your chosen provider on this computer. You
          only need one provider. Signing in to their website does not install the CLI.
        </Typography>
      </Stack>
      <ToggleButtonGroup
        exclusive
        value={dock.provider}
        disabled={busy}
        onChange={(_, value) => {
          if (value) {
            onConnectionChange(null);
            setError("");
            setCancelled(false);
            void dock.switchProvider(value);
          }
        }}
      >
        <ToggleButton value="claude">Claude Code</ToggleButton>
        <ToggleButton value="codex">Codex</ToggleButton>
      </ToggleButtonGroup>
      <Button
        component="a"
        href={
          dock.provider === "claude"
            ? "https://code.claude.com/docs/en/setup"
            : "https://developers.openai.com/codex/cli/"
        }
        target="_blank"
        rel="noopener noreferrer"
        sx={{ alignSelf: "flex-start" }}
      >
        Install or update {providerDisplayName(dock.provider)}
      </Button>
      {health !== "reachable" && <PluginInstallCommands />}
      {health !== "reachable" && <Button onClick={recheck}>Reconnect companion</Button>}
      {health === "reachable" && (
        <>
          <Alert severity={verified === dock.provider ? "success" : "info"}>
            {verified === dock.provider
              ? `${providerDisplayName(dock.provider)} completed a test request. Ready to extract your resume.`
              : "Companion detected. Verify your model connection before importing a resume."}
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button
              variant="outlined"
              onClick={() => {
                if (desktop) dock.expand();
                else setTerminalOpen(true);
              }}
            >
              Open agent terminal to sign in
            </Button>
            <Button variant="contained" onClick={() => void check()} disabled={busy}>
              {busy && <CircularProgress size={18} sx={{ mr: 1 }} />}
              {busy ? "Verifying…" : "Verify connection"}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Verification sends one short test request. Claude uses Haiku; Codex uses its CLI
            default. It counts toward your provider usage.
            {busy && " This can take up to two minutes. You can cancel at any time."}
          </Typography>
        </>
      )}
      {busy && (
        <Button sx={{ alignSelf: "flex-start" }} onClick={cancelCheck}>
          Cancel verification
        </Button>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {cancelled && (
        <Alert severity="info">
          Verification cancelled. You can retry or choose another provider.
        </Alert>
      )}
      <Dialog open={terminalOpen} onClose={() => setTerminalOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Sign in to {providerDisplayName(dock.provider)}</DialogTitle>
        <DialogContent sx={{ height: "60dvh" }}>
          <TerminalPanel key={dock.terminalRevision} provider={dock.provider} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void dock.restart()}>Restart terminal</Button>
          <Button onClick={() => setTerminalOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>
      <Typography variant="body2" color="text.secondary">
        You can fill your profile manually and connect later. Your computer must stay awake with the
        companion running for local agent work.
      </Typography>
    </Stack>
  );
}
