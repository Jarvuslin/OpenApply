import { api } from "./client";
import { queryKeys } from "./query-keys";

export const telegramQueries = {
  status: () => ({
    queryKey: queryKeys.telegram.status(),
    queryFn: () => api.telegram.get(),
  }),
  intake: (id: string) => ({
    queryKey: queryKeys.jobIntakes.detail(id),
    queryFn: () => api["job-intakes"]({ id }).get(),
  }),
};
