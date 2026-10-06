"use client";

import { Box, Button, CircularProgress, Stack, SvgIcon, Typography } from "@mui/material";
import { useTerminalHealth } from "@/components/features/agent-dock/use-terminal-health";
import { providerDisplayName, type TerminalProviderId } from "@/lib/terminal";
import { useAgentDock } from "@/providers/agent-provider";

export interface ProviderConnection {
  provider: TerminalProviderId;
  state: "verifying" | "connected";
}

interface AgentConnectionStatusProps {
  connection: ProviderConnection | null;
  onManage: () => void;
}

export function AgentConnectionStatus({ connection, onManage }: AgentConnectionStatusProps) {
  const { provider } = useAgentDock();
  const { health } = useTerminalHealth();
  const current = connection?.provider === provider ? connection : null;
  const connected = health === "reachable" && current?.state === "connected";
  const checking = health === "checking" || current?.state === "verifying";
  let label = "Not verified";
  if (health === "offline" || health === "uninstalled" || health === "degraded")
    label = "Companion offline";
  else if (health === "checking") label = "Checking companion…";
  else if (checking) label = "Verifying…";
  else if (connected) label = "Connected";

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", borderTop: 1, borderColor: "divider", pt: 2 }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 36,
          height: 36,
          display: "grid",
          placeItems: "center",
          borderRadius: 1.5,
          bgcolor: "action.hover",
          color: "text.primary",
        }}
      >
        {provider === "claude" && (
          <SvgIcon viewBox="0 0 24 24" sx={{ color: "warning.main" }}>
            <path
              fillRule="evenodd"
              d="M5 5h14v3h3v8h-3v4h-3v-4H8v4H5v-4H2V8h3V5Zm3 4v3h2V9H8Zm6 0v3h2V9h-2Z"
            />
          </SvgIcon>
        )}
        {provider === "codex" && <Typography variant="caption">GPT</Typography>}
      </Box>
      <Stack spacing={0.25} sx={{ flex: 1 }}>
        <Typography variant="body2Strong">{providerDisplayName(provider)}</Typography>
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ alignItems: "center" }}
          role="status"
          aria-live="polite"
        >
          {checking && <CircularProgress size={8} color="inherit" />}
          {!checking && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: connected ? "success.main" : "text.disabled",
              }}
            />
          )}
          <Typography variant="caption" color={connected ? "success.main" : "text.secondary"}>
            {label}
          </Typography>
        </Stack>
      </Stack>
      <Button size="small" onClick={onManage}>
        Manage connection
      </Button>
    </Stack>
  );
}
