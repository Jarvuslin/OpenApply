import type { PilotRules } from "@openapply/contracts/pilots";
import { api } from "./client";
import { queryKeys } from "./query-keys";

type ResultsQuery = NonNullable<
  Parameters<ReturnType<typeof api.pilots>["results"]["get"]>[0]
>["query"];

export const pilotQueries = {
  list: () => ({ queryKey: queryKeys.pilots.list(), queryFn: () => api.pilots.get() }),
  detail: (id: string) => ({
    queryKey: queryKeys.pilots.detail(id),
    queryFn: () => api.pilots({ id }).get(),
  }),
  results: (id: string, query: ResultsQuery) => ({
    queryKey: queryKeys.pilots.results(id, query),
    queryFn: () => api.pilots({ id }).results.get({ query }),
  }),
  preview: (rules: PilotRules) => ({
    queryKey: queryKeys.pilots.preview(rules),
    queryFn: () => api.pilots.preview.post({ rules }),
  }),
};

export type PilotDto = NonNullable<
  Awaited<ReturnType<ReturnType<typeof pilotQueries.detail>["queryFn"]>>["data"]
>;
export type PilotResultDto = NonNullable<
  Awaited<ReturnType<ReturnType<typeof pilotQueries.results>["queryFn"]>>["data"]
>["items"][number];
