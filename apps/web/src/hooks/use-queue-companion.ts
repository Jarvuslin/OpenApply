"use client";

import { useQuery } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import { queueQueries } from "@/api/queue-queries";
import { getQueueCompanion } from "@/lib/queue-companion";
import { useSession } from "./use-auth";

export function useQueueCompanion() {
  const { user } = useSession();
  const query = useQuery({
    queryKey: [...queryKeys.queue.companion(), user?.id],
    queryFn: getQueueCompanion,
    enabled: !!user,
    retry: false,
    refetchInterval: 10_000,
  });
  const presence = useApiQuery(queueQueries.presence(), {
    enabled: !!user,
    retry: false,
    refetchInterval: 30_000,
  });
  const status = !query.isError && user && query.data?.ownerId === user.id ? query.data : undefined;
  return { query, presence, status, accountId: user?.id };
}
