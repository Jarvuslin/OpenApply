import type { ReactElement } from "react";
import { Paper } from "@mui/material";
import { PluginInstallCommands } from "./plugin-install-commands";

export function InstallGuide(): ReactElement {
  return (
    <Paper variant="panel" sx={{ p: 3 }}>
      <PluginInstallCommands />
    </Paper>
  );
}
