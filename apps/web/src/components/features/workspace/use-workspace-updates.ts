"use client";

import { workspaceChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { useSseChannel } from "@/lib/sse/client";

export function useWorkspaceUpdates(): void {
  const queryClient = useQueryClient();
  useSseChannel(workspaceChannel, null, {
    onMessage: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
    },
  });
}
