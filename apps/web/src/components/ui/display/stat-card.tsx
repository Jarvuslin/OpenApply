"use client";

import type { ReactElement, ReactNode } from "react";
import { Box, Card, Stack, Tooltip, Typography } from "@mui/material";
import { Info } from "lucide-react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Green for good news, as in the design's "+12 this week". */
  hintTone?: "positive" | "muted";
  trend?: ReactNode;
  /** What the number counts, shown on hover. */
  definition?: string;
}

/** The design's stat card: label, a 24px number, one short caption. */
export function StatCard(props: StatCardProps): ReactElement {
  const { label, value, hint, hintTone = "muted", trend, definition } = props;
  return (
    <Card sx={{ height: "100%" }}>
      <Stack spacing={0.75} sx={{ p: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Typography variant="statLabel">{label}</Typography>
          {definition && (
            <Tooltip title={definition} arrow>
              <Box
                component="span"
                sx={{ display: "flex", color: "text.disabled", cursor: "help" }}
              >
                <Info size={13} strokeWidth={1.75} aria-label={`About ${label}`} />
              </Box>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
          <Typography variant="statValue">{value}</Typography>
          {trend && <Box>{trend}</Box>}
        </Stack>
        {hint && (
          <Typography
            variant="caption"
            sx={{ color: hintTone === "positive" ? "success.main" : "text.secondary" }}
          >
            {hint}
          </Typography>
        )}
      </Stack>
    </Card>
  );
}
