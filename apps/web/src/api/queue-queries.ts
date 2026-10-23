import type { WorkListQuery } from "@openapply/contracts/work-queue";
import { api } from "./client";
import { queryKeys } from "./query-keys";

export const queueQueries = {
  presence: () => ({
    queryKey: ["runtime-presence"] as const,
    queryFn: () => api.runtime.presence.get(),
  }),
  limits: () => ({
    queryKey: queryKeys.queue.limits(),
    queryFn: () => api["work-queue"].limits.get(),
  }),
  list: (query: WorkListQuery) => ({
    queryKey: queryKeys.queue.list(query),
    queryFn: () => api["work-queue"].get({ query }),
  }),
  summary: () => ({
    queryKey: queryKeys.queue.summary(),
    queryFn: () => api["work-queue"].summary.get(),
  }),
  detail: (id: string) => ({
    queryKey: queryKeys.queue.detail(id),
    queryFn: () => api["work-queue"]({ id }).get(),
  }),
  timeline: (id: string) => ({
    queryKey: queryKeys.queue.timeline(id),
    queryFn: () => api["work-queue"]({ id }).timeline.get(),
  }),
};

export type QueueItemDto = NonNullable<
  Awaited<ReturnType<ReturnType<typeof queueQueries.list>["queryFn"]>>["data"]
>["items"][number];
