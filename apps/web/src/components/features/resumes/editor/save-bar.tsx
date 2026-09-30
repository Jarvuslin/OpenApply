"use client";

import type { ReactElement } from "react";
import { Save } from "@mui/icons-material";
import { Button, Stack, Typography } from "@mui/material";
import { StickyFooter } from "@/components/ui/layout";
import type { SaveState } from "./use-autosave";

const STATUS: Record<SaveState, string> = {
  clean: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving",
  saved: "Saved",
  error: "Couldn't save",
};

interface SaveBarProps {
  state: SaveState;
  onSave: () => void;
  /** Set when the resume changed elsewhere (a tailor or extract run) while edits were pending. */
  conflict?: ReactElement | null;
}

export function SaveBar(props: SaveBarProps): ReactElement {
  const { state, onSave, conflict } = props;

  return (
    <StickyFooter>
      {conflict}
      <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
        <Typography variant="captionMuted" color={state === "error" ? "error.main" : undefined}>
          {STATUS[state]}
        </Typography>
        <Button
          variant={state === "error" ? "contained" : "outlined"}
          size="small"
          startIcon={<Save fontSize="sm" />}
          disabled={state === "saving"}
          onClick={onSave}
        >
          {state === "error" ? "Retry" : "Save now"}
        </Button>
      </Stack>
    </StickyFooter>
  );
}
