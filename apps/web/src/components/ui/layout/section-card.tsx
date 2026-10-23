"use client";

import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { Box, Card, Stack, Typography } from "@mui/material";

interface SectionCardProps extends PropsWithChildren {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** An 18px line icon before the title. */
  icon?: ReactNode;
  /** Content that draws its own rows edge to edge, such as a list or table. */
  flush?: boolean;
  /** Stretch to its grid cell so side-by-side cards line up. */
  fullHeight?: boolean;
}

/** The design's card: a 52px header with a divider, then the content. */
export function SectionCard(props: SectionCardProps): ReactElement {
  const { title, description, actions, icon, flush = false, fullHeight = false, children } = props;
  const header = title || description || actions;
  return (
    <Card
      sx={fullHeight ? { height: "100%", display: "flex", flexDirection: "column" } : undefined}
    >
      {header && (
        <Stack
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: "center",
            minHeight: 52,
            px: 2,
            py: description ? 1.25 : 0,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {icon && <Box sx={{ display: "flex", color: "text.primary" }}>{icon}</Box>}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title && (
              <Typography variant="h4" component="h2">
                {title}
              </Typography>
            )}
            {description && <Typography variant="captionMuted">{description}</Typography>}
          </Box>
          {actions && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
              {actions}
            </Stack>
          )}
        </Stack>
      )}
      <Box
        sx={{
          p: flush ? 0 : 2,
          ...(fullHeight && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }),
        }}
      >
        {children}
      </Box>
    </Card>
  );
}
