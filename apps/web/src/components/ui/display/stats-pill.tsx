"use client";

import { Fragment, type ReactElement, type ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

interface StatsPillItem {
  icon: ReactNode;
  value: ReactNode;
  label: string;
}

interface StatsPillProps {
  items: StatsPillItem[];
}

/** A rounded strip of headline counts separated by thin rules. */
export function StatsPill({ items }: StatsPillProps): ReactElement {
  return (
    <Stack
      direction="row"
      sx={(theme) => ({
        alignSelf: "flex-start",
        alignItems: "center",
        flexWrap: "wrap",
        minHeight: 44,
        px: 1,
        borderRadius: theme.radii.pill,
        border: 1,
        borderColor: "divider",
        bgcolor: "surfaces.elevated",
      })}
    >
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && <Box sx={{ width: "1px", height: 18, bgcolor: "line.borderHi" }} />}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1.75 }}>
            <Box sx={{ display: "flex", color: "text.primary" }}>{item.icon}</Box>
            <Typography sx={{ fontSize: "0.9375rem", lineHeight: "20px", fontWeight: 600 }}>
              {item.value}
            </Typography>
            <Typography variant="captionMuted">{item.label}</Typography>
          </Stack>
        </Fragment>
      ))}
    </Stack>
  );
}
