"use client";

import { useApiQuery } from "@/api/hooks";
import { authQueries } from "@/api/queries";

export function useAuthOptions() {
  return useApiQuery(authQueries.options(), { staleTime: 30_000, retry: 1 });
}
