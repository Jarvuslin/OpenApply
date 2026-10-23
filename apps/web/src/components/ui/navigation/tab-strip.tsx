import type { ReactElement } from "react";
import { Box, Stack } from "@mui/material";
import type { Route } from "next";
import { theme } from "@/theme/theme";
import { TabLink } from "./tab-link";

export interface Tab {
  label: string;
  href: Route;
}

interface TabStripProps {
  tabs: Tab[];
  ariaLabel: string;
}

/** Server-rendered section tab strip; only the active-link highlight is client-side. */
export function TabStrip(props: TabStripProps): ReactElement {
  const { tabs, ariaLabel } = props;

  return (
    <Box
      component="nav"
      aria-label={ariaLabel}
      sx={{
        overflowX: "auto",
        // overflow-x:auto computes overflow-y to auto too; sub-pixel rounding then adds a scrollbar.
        overflowY: "hidden",
        // Inset shadow, not a border: paints inside the padding box so the active tab covers it.
        boxShadow: `inset 0 -1px 0 ${theme.palette.divider}`,
      }}
    >
      <Stack direction="row" spacing={1}>
        {tabs.map((tab) => (
          <TabLink key={tab.href} href={tab.href} label={tab.label} />
        ))}
      </Stack>
    </Box>
  );
}
