"use client";

import type { ReactElement, ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

interface DetailRowProps {
  label: string;
  children: ReactNode;
  /** Draw a line under the row. Off for cards that separate rows by spacing alone. */
  ruled?: boolean;
}

/** One label and value line in a settings card, ruled off from the next. */
export function DetailRow({ label, children, ruled = true }: DetailRowProps): ReactElement {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        minHeight: 40,
        px: 2,
        py: 1,
        borderBottom: ruled ? 1 : 0,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Typography variant="body2Muted" sx={{ width: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}
