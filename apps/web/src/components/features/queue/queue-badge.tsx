"use client";

import type { ReactNode } from "react";
import { Typography } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { queueQueries } from "@/api/queue-queries";
import { useHydrated } from "@/hooks/use-hydrated";

interface QueueCountProps {
  active: boolean;
}

/** Queued plus running work, as a quiet number at the end of the Queue nav item. */
export function QueueCount({ active }: QueueCountProps): ReactNode {
  const query = useApiQuery(queueQueries.summary(), { retry: false, refetchInterval: 15_000 });
  const hydrated = useHydrated();
  if (!hydrated || query.error || !query.data) return null;
  const count = query.data.queued + query.data.running;
  if (count === 0) return null;
  return (
    <Typography
      component="span"
      variant="caption"
      title={`${count} queued or running`}
      sx={{ color: active ? "inherit" : "text.disabled" }}
    >
      {count}
    </Typography>
  );
}
