import type { JobListingQuery } from "@openapply/contracts/job-listing";
import { api } from "./client";

function encodeQuery(query: JobListingQuery) {
  return {
    ...query,
    titles: query.titles ? [JSON.stringify(query.titles)] : undefined,
    locations: query.locations ? [JSON.stringify(query.locations)] : undefined,
    companies: query.companies ? [JSON.stringify(query.companies)] : undefined,
    excludeCompanies: query.excludeCompanies ? [JSON.stringify(query.excludeCompanies)] : undefined,
    excludeTitles: query.excludeTitles ? [JSON.stringify(query.excludeTitles)] : undefined,
  };
}

export const discoverQueries = {
  list: (query: JobListingQuery, saved: boolean) => ({
    queryKey: ["discover", saved ? "saved" : "list", query] as const,
    queryFn: () => {
      const encoded = encodeQuery(query);
      return saved ? api.jobs.saved.get({ query: encoded }) : api.jobs.get({ query: encoded });
    },
  }),
  updates: (query: JobListingQuery & { indexedBefore: string }) => ({
    queryKey: ["discover", "updates", query] as const,
    queryFn: () =>
      api.jobs.updates.get({
        query: { ...encodeQuery(query), indexedBefore: query.indexedBefore },
      }),
  }),
  coverage: () => ({
    queryKey: ["discover-sources", "coverage"] as const,
    queryFn: () => api["job-sources"].coverage.get(),
  }),
  count: () => ({
    queryKey: ["discover", "saved-count"] as const,
    queryFn: () => api.jobs.saved.count.get(),
  }),
  detail: (slug: string) => ({
    queryKey: ["discover", "detail", slug] as const,
    queryFn: () => api.jobs({ slug }).get(),
  }),
};
