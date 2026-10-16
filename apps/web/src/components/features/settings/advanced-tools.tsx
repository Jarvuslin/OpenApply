"use client";

import { type ReactElement, useSyncExternalStore } from "react";
import { Button, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { SectionCard } from "@/components/ui/layout";
import {
  getAdvancedToolsEnabled,
  patchAgentStorage,
  subscribeAgentStorage,
} from "@/lib/agent-storage";
import { useAgentDock } from "@/providers/agent-provider";

function useAdvancedTools(): boolean {
  return useSyncExternalStore(subscribeAgentStorage, getAdvancedToolsEnabled, () => false);
}

export function AdvancedTools(): ReactElement {
  const enabled = useAdvancedTools();
  const { expand, collapse } = useAgentDock();
  return (
    <SectionCard title="Advanced tools">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          The queue runs on your connected computer. Enable these tools on this browser for direct
          terminal access.
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(_, checked) => {
                collapse();
                patchAgentStorage({ advancedTools: checked });
              }}
            />
          }
          label="Show advanced tools"
        />
        {enabled && (
          <Button onClick={expand} variant="outlined" sx={{ alignSelf: "flex-start" }}>
            Open terminal
          </Button>
        )}
      </Stack>
    </SectionCard>
  );
}
