"use client";

import { type PropsWithChildren, type ReactElement, useSyncExternalStore } from "react";
import { Box } from "@mui/material";
import { AgentDock } from "@/components/features/agent-dock/agent-dock";
import { VerifyEmailBanner } from "@/components/features/auth";
import { getAdvancedToolsEnabled, subscribeAgentStorage } from "@/lib/agent-storage";
import { QueueAutoReconnect } from "./queue-auto-reconnect";
import { Rail } from "./rail";

export function AppShell(props: PropsWithChildren): ReactElement {
  const { children } = props;
  const advancedTools = useSyncExternalStore(
    subscribeAgentStorage,
    getAdvancedToolsEnabled,
    () => false,
  );
  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        height: "100dvh",
        overflow: "hidden",
        backgroundColor: theme.palette.surfaces.base,
      })}
    >
      <QueueAutoReconnect />
      <Rail />
      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <VerifyEmailBanner />
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", py: 4 }}>{children}</Box>
      </Box>
      {advancedTools && <AgentDock />}
    </Box>
  );
}
