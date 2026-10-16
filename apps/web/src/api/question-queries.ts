import type { NeedsYouQuery } from "@openapply/contracts/application-question";
import { api } from "./client";
import { queryKeys } from "./query-keys";

export const questionQueries = {
  list: (query: NeedsYouQuery) => ({
    queryKey: queryKeys.needsYou.list(query),
    queryFn: () => api["needs-you"].get({ query }),
  }),
  count: () => ({
    queryKey: queryKeys.needsYou.count(),
    queryFn: () => api["needs-you"].count.get(),
  }),
  preparation: (id: string) => ({
    queryKey: queryKeys.applicationQuestions.preparation(id),
    queryFn: () => api.jobs({ slug: id }).preparation.get({ query: { mode: "preview" } }),
  }),
};
