import type { ReactElement } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { GITHUB_URL } from "@/lib/constants";
import { HostInstallCommands } from "./host-install-commands";

export function PluginInstallCommands(): ReactElement {
  return (
    <Stack spacing={2}>
      <Typography variant="body2Muted">
        OpenApply runs from source on Windows with WSL2 or on Mac with Lima (beta). Follow the setup
        instructions for your machine before starting the app.
      </Typography>
      <HostInstallCommands />
      <Button component="a" href={`${GITHUB_URL}#setup`} target="_blank" rel="noopener noreferrer">
        Clone and setup instructions
      </Button>
    </Stack>
  );
}
