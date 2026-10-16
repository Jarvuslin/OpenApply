"use client";

import type { PilotQuestion } from "@openapply/contracts/pilot";
import { pilotChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useSseChannel } from "@/lib/sse/client";

interface OpenQuestions {
  questions: PilotQuestion[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Open questions, kept fresh by the pilot SSE channel. */
export function useOpenQuestions(): OpenQuestions {
  const queryClient = useQueryClient();
  const query = useApiQuery(pilotQueries.questions("open"));

  const refresh = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pilot.questionsAll() });
  };

  useSseChannel(pilotChannel, null, {
    on: { "question.created": refresh, "question.answered": refresh },
  });

  return {
    questions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
