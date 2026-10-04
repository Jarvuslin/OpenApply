import type { ReactElement } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { GITHUB_URL } from "@/lib/constants";
import { providerDisplayName, type TerminalProviderId } from "@/lib/terminal";

export function UpdateManualSteps({ provider }: { provider: TerminalProviderId }): ReactElement {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2Muted">
        OpenApply uses a source checkout. Finish any active {providerDisplayName(provider)} task and
        follow the README to update and rebuild the local host.
      </Typography>
      <Button
        component="a"
        href={`${GITHUB_URL}#development-checks`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open repository instructions
      </Button>
    </Stack>
  );
}
