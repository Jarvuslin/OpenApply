"use client";

import { needsYouChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useApiQuery } from "@/api/hooks";
import { invalidations } from "@/api/query-keys";
import { questionQueries } from "@/api/question-queries";
import { useSseChannel } from "@/lib/sse/client";
import { streamResumed } from "@/lib/sse/connection-status";

export function useNeedsYouCount() {
  const client = useQueryClient();
  const status = useSseChannel(needsYouChannel, null, {
    onMessage: () => {
      for (const queryKey of invalidations.questions) void client.invalidateQueries({ queryKey });
    },
  });
  const previous = useRef(status);
  useEffect(() => {
    if (streamResumed(previous.current, status)) {
      for (const queryKey of invalidations.questions) void client.invalidateQueries({ queryKey });
    }
    previous.current = status;
  }, [status, client]);
  return useApiQuery(questionQueries.count(), { refetchInterval: 15_000 });
}
