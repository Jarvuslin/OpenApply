"use client";

import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { Target } from "lucide-react";
import type { AnalyticsStatsDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";

interface MatchScoreCardProps {
  data: AnalyticsStatsDto["matchScore"];
}

/** How well the jobs you applied to fit your profile, by the scorer's 0–100 match score. */
export function MatchScoreCard({ data }: MatchScoreCardProps): ReactElement {
  const bands = [
    { label: "Strong (80+)", count: data.strong, color: "success.main" },
    { label: "Medium (60–79)", count: data.medium, color: "warning.main" },
    { label: "Weak (<60)", count: data.weak, color: "error.main" },
  ];
  return (
    <SectionCard
      fullHeight
      title="Match score"
      icon={<Target size={18} strokeWidth={1.75} aria-hidden />}
    >
      {data.average == null ? (
        <Typography variant="body2Muted">No scored applications yet.</Typography>
      ) : (
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
            <Typography variant="statValue">{data.average}</Typography>
            <Typography variant="captionMuted">/ 100 avg for applied jobs</Typography>
          </Stack>
          <Stack direction="row" spacing={0.25} sx={{ height: 8 }} aria-hidden>
            {bands
              .filter((band) => band.count > 0)
              .map((band) => (
                <Box
                  key={band.label}
                  sx={{
                    flex: band.count,
                    bgcolor: band.color,
                    borderRadius: (t) => t.radii.xs,
                    opacity: 0.6,
                  }}
                />
              ))}
          </Stack>
          <Stack spacing={0.75}>
            {bands.map((band) => (
              <Stack key={band.label} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: band.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {band.label}
                </Typography>
                <Typography variant="body2Strong">{band.count}</Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
    </SectionCard>
  );
}
