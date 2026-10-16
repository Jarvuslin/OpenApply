"use client";

import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { useHydrated } from "@/hooks/use-hydrated";
import { useNeedsYouCount } from "@/hooks/use-needs-you";

/** A pink count at the end of the Needs you nav item; nothing when nothing waits. */
export function NeedsYouCount(): ReactNode {
  const query = useNeedsYouCount();
  const hydrated = useHydrated();
  const count = !hydrated || query.isError ? undefined : query.data?.total;
  if (!count) return null;
  return (
    <Box
      component="span"
      title={`${count} items need you`}
      sx={(theme) => ({
        minWidth: 20,
        height: 20,
        px: 0.75,
        display: "inline-grid",
        placeItems: "center",
        borderRadius: theme.radii.sm,
        bgcolor: "statusTints.attention",
        color: "status.attention",
        fontSize: "0.6875rem",
        lineHeight: "14px",
        fontWeight: 500,
      })}
    >
      {count}
    </Box>
  );
}
