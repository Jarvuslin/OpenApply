import type { ReactElement } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { GITHUB_URL } from "@/lib/constants";
import { HostInstallCommands } from "./host-install-commands";

export function PluginInstallCommands(): ReactElement {
  return (
    <Stack spacing={2}>
      <Typography variant="body2Muted">
        OpenApply currently runs from source on Windows with WSL2. Configure the VM using the README
        before starting the app.
      </Typography>
      <HostInstallCommands />
      <Button
        component="a"
        href={`${GITHUB_URL}#clone-and-setup-windows`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Clone and setup instructions
      </Button>
    </Stack>
  );
}
