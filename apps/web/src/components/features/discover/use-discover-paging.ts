"use client";

import type { JobListingQuery } from "@openapply/contracts/job-listing";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { discoverQueries } from "@/api/discover-queries";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";

export function useDiscoverPaging(query: JobListingQuery, saved: boolean, enabled: boolean) {
  const queryClient = useQueryClient();
  const jobs = useApiQuery(discoverQueries.list(query, saved), {
    enabled,
    staleTime: query.indexedBefore ? 30_000 : 0,
  });
  const updates = useApiQuery(
    discoverQueries.updates({ ...query, page: 1, indexedBefore: query.indexedBefore ?? "" }),
    {
      enabled: enabled && !saved && !!query.indexedBefore,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      staleTime: 30_000,
    },
  );
  const nextPage = jobs.data?.pagination.totalPages ?? 0;
  const prefetchKey = JSON.stringify({ ...query, page: query.page + 1 });

  useEffect(() => {
    if (!enabled || !query.indexedBefore || query.page >= nextPage || query.page >= 500) return;
    const next = discoverQueries.list(JSON.parse(prefetchKey) as JobListingQuery, saved);
    void queryClient.prefetchQuery({
      queryKey: next.queryKey,
      queryFn: async () => {
        const result = await next.queryFn();
        if (result.error) throw new ApiError(result.error);
        return result.data;
      },
      staleTime: 30_000,
    });
  }, [enabled, query.indexedBefore, query.page, nextPage, prefetchKey, saved, queryClient]);

  return { jobs, updates };
}
