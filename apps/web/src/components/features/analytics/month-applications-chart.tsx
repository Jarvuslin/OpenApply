"use client";

import type { ReactElement } from "react";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { CalendarDays } from "lucide-react";
import type { AnalyticsPerDayEntry } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";

// A single application should not fill the whole bar height.
const MIN_SCALE = 4;
const CHART_HEIGHT = 132;

interface MonthApplicationsChartProps {
  data: AnalyticsPerDayEntry[];
}

/** One rounded bar per day of the current month; days still ahead stay faint. */
export function MonthApplicationsChart({ data }: MonthApplicationsChartProps): ReactElement {
  const total = data.reduce((n, day) => n + day.count, 0);
  const scale = Math.max(MIN_SCALE, ...data.map((day) => day.count));
  const month = data[0]
    ? new Date(data[0].date).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })
    : "";
  const today = new Date().getUTCDate();
  return (
    <SectionCard
      fullHeight
      title="Applications this month"
      icon={<CalendarDays size={18} strokeWidth={1.75} aria-hidden />}
      actions={<Typography variant="captionMuted">{total} total</Typography>}
    >
      <Stack spacing={1} sx={{ height: CHART_HEIGHT, mt: "auto" }}>
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ flex: 1, alignItems: "flex-end" }}
          role="img"
          aria-label={`${total} applications in ${month}`}
        >
          {data.map((day) => {
            const date = new Date(day.date).getUTCDate();
            const ahead = date > today;
            return (
              <Tooltip
                key={date}
                title={`${month} ${date}: ${day.count} ${day.count === 1 ? "application" : "applications"}`}
                disableInteractive
              >
                <Box
                  sx={{
                    flex: 1,
                    height: day.count ? `${(day.count / scale) * 100}%` : 4,
                    minHeight: 4,
                    borderRadius: (t) => t.radii.xs,
                    bgcolor: day.count ? "primary.main" : "action.hover",
                    opacity: ahead ? 0.5 : 1,
                  }}
                />
              </Tooltip>
            );
          })}
        </Stack>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          {[1, 15, data.length].map((date) => (
            <Typography key={date} variant="captionMuted">
              {month} {date}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </SectionCard>
  );
}
