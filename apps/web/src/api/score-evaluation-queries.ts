import type { PaginationQuery } from "@openapply/contracts/pagination";
import { api } from "./client";
import { queryKeys } from "./query-keys";

export const scoreEvaluationQueries = {
  list: (query: PaginationQuery) => ({
    queryKey: queryKeys.scoreEvaluations.list(query),
    queryFn: () => api["score-evaluations"].get({ query }),
  }),
  cases: (id: string, query: PaginationQuery) => ({
    queryKey: queryKeys.scoreEvaluations.cases(id, query),
    queryFn: () => api["score-evaluations"]({ id }).cases.get({ query }),
  }),
  report: (id: string) => ({
    queryKey: queryKeys.scoreEvaluations.report(id),
    queryFn: () => api["score-evaluations"]({ id }).report.get(),
  }),
};
