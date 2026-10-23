"use client";

import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { Bell, CircleCheck, Clock } from "lucide-react";
import { useApiQuery } from "@/api/hooks";
import { analyticsQueries, userQueries } from "@/api/queries";
import { queueQueries } from "@/api/queue-queries";
import { StatsPill } from "@/components/ui/display";
import { useHydrated } from "@/hooks/use-hydrated";
import { useNeedsYouCount } from "@/hooks/use-needs-you";

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Today's date, a greeting and the three numbers that matter at a glance. */
export function DashboardHeader(): ReactElement {
  const hydrated = useHydrated();
  const profile = useApiQuery(userQueries.detail());
  const queue = useApiQuery(queueQueries.summary(), { retry: false });
  const analytics = useApiQuery(analyticsQueries.stats());
  const needsYou = useNeedsYouCount();
  const now = new Date();
  const name = profile.data?.user.preferredName || profile.data?.user.firstName;
  const count = (value: number | undefined) => (value === undefined ? "—" : value);
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
    >
      <Box>
        <Typography variant="captionMuted" component="p">
          {hydrated
            ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
            : " "}
        </Typography>
        <Typography variant="h1" sx={{ mt: 0.75 }}>
          {hydrated ? greeting(now.getHours()) : "Hello"}
          {name ? `, ${name}` : ""}
        </Typography>
      </Box>
      <Box sx={{ display: "flex" }}>
        <StatsPill
          items={[
            {
              icon: <Clock size={16} strokeWidth={1.75} aria-hidden />,
              value: count(queue.data ? queue.data.queued + queue.data.running : undefined),
              label: "in queue",
            },
            {
              icon: <CircleCheck size={16} strokeWidth={1.75} aria-hidden />,
              value: count(analytics.data?.totals.applications),
              label: "submitted",
            },
            {
              icon: <Bell size={16} strokeWidth={1.75} aria-hidden />,
              value: count(needsYou.data?.total),
              label: "need you",
            },
          ]}
        />
      </Box>
    </Stack>
  );
}
