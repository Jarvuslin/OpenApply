"use client";
import { useState } from "react";
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

export function AgentSetupStep() {
  const { health } = useTerminalHealth();
  const dock = useAgentDock();
  const desktop = useAgentAvailable();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState("");
  const [error, setError] = useState("");
  const check = async () => {
    setBusy(true);
    setError("");
    setVerified("");
    try {
      const result = await runInference(dock.provider);
      setVerified(result.provider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify the connection");
    } finally {
      setBusy(false);
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
      </Stack>
      <ToggleButtonGroup
        exclusive
        value={dock.provider}
        disabled={busy}
        onChange={(_, value) => {
          if (value) {
            setVerified("");
            setError("");
            void dock.switchProvider(value);
          }
        }}
      >
        <ToggleButton value="claude">Claude Code</ToggleButton>
        <ToggleButton value="codex">Codex</ToggleButton>
      </ToggleButtonGroup>
      {health !== "reachable" && <PluginInstallCommands />}
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
              {busy ? <CircularProgress size={18} /> : "Verify connection"}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Verification sends one short test request. Claude uses Haiku; Codex uses its CLI
            default. It counts toward your provider usage.
          </Typography>
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Dialog open={terminalOpen} onClose={() => setTerminalOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Sign in to {providerDisplayName(dock.provider)}</DialogTitle>
        <DialogContent sx={{ height: "60dvh" }}>
          <TerminalPanel provider={dock.provider} />
        </DialogContent>
        <DialogActions>
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
