"use client";

import type { ReactElement, ReactNode } from "react";
import { LinearProgress, Stack, Typography } from "@mui/material";
import { SectionCard } from "@/components/ui/layout";

interface TopBoardsListProps {
  title: string;
  icon: ReactNode;
  entries: { label: string; count: number }[];
  emptyMessage: string;
}

export function TopBoardsList(props: TopBoardsListProps): ReactElement {
  const { title, icon, entries, emptyMessage } = props;
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);

  return (
    <SectionCard fullHeight title={title} icon={icon}>
      {entries.length === 0 ? (
        <Typography variant="captionMuted">{emptyMessage}</Typography>
      ) : (
        <Stack spacing={1.25}>
          {entries.map((entry) => {
            const pct = max > 0 ? (entry.count / max) * 100 : 0;
            return (
              <Stack key={entry.label} spacing={0.5}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="body1">{entry.label}</Typography>
                  <Typography variant="captionMuted">{entry.count}</Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={(t) => ({
                    height: 4,
                    borderRadius: t.radii.xs,
                    backgroundColor: t.palette.line.divider,
                    "& .MuiLinearProgress-bar": {
                      backgroundColor: t.palette.accent.primary,
                    },
                  })}
                />
              </Stack>
            );
          })}
        </Stack>
      )}
    </SectionCard>
  );
}
