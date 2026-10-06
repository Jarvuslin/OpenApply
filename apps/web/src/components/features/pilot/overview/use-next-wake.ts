"use client";

import { type PilotJournalPage, pilotCycleDetailSchema } from "@openapply/contracts/pilot";
import { useEffect, useState } from "react";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";

const TICK_MS = 30_000;

/** A number, so the query only re-renders callers when the wake time itself moves. */
function selectWakeMs(page: PilotJournalPage): number | null {
  const cycle = page.items.find((entry) => entry.kind === "cycle");
  const sleepSeconds = cycle && pilotCycleDetailSchema.safeParse(cycle.detail).data?.sleepSeconds;
  if (!cycle || sleepSeconds == null) {
    return null;
  }
  return cycle.createdAt.getTime() + sleepSeconds * 1000;
}

/**
 * The newest cycle's completion plus the sleep it announced. The agenda carries the same figure,
 * but its query is pinned and goes stale; the journal cache is streamed into and stays live.
 */
export function useNextWake(): Date | null {
  const { data: wakeMs = null } = useApiQuery(pilotQueries.journal(), { select: selectWakeMs });

  // Only a pending wake has a countdown to keep moving; callers render a static label after it.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (wakeMs === null || wakeMs <= Date.now()) {
      return;
    }
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [wakeMs]);

  return wakeMs === null ? null : new Date(wakeMs);
}
