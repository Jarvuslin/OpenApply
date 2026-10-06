"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { pilotChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { useSseChannel } from "@/lib/sse/client";
import { appendJournalEntry } from "./journal/use-journal-live";

/**
 * The pilot layout's one SSE subscription, fanned out to query invalidations. `journal.appended`
 * writes straight into the journal caches instead, so it costs no refetch.
 */
export function PilotLive(): ReactNode {
  const queryClient = useQueryClient();

  const invalidate = (queryKey: readonly unknown[]): void => {
    queryClient.invalidateQueries({ queryKey });
  };
  const refreshQuestions = (): void => invalidate(queryKeys.pilot.questionsAll());

  const status = useSseChannel(pilotChannel, null, {
    on: {
      "state.changed": () => invalidate(queryKeys.pilot.state()),
      "journal.appended": (event) => appendJournalEntry(queryClient, event.entry),
      "question.created": refreshQuestions,
      "question.answered": refreshQuestions,
    },
  });

  // Catch up on events missed while reconnecting. Never `pilot.all`: that would recompile the agenda.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === "reconnecting" && status === "open") {
      queryClient.invalidateQueries({ queryKey: queryKeys.pilot.state() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pilot.journalAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pilot.questionsAll() });
    }
    previousStatus.current = status;
  }, [status, queryClient]);

  return null;
}
