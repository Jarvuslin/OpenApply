import type { QueueLimits } from "@openapply/contracts/work-queue-limits";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { createQueueRequestStore, sendQueueRequest } from "@/lib/queue-request";
import { queueLimitsDraft, queueLimitsDraftSchema, queueLimitsInput } from "./queue-limits-draft";
import { QueueLimitsPanel } from "./queue-limits-panel";
import { expect, test } from "bun:test";

const limits: QueueLimits = {
  revision: 1,
  maxConcurrentWorkers: 1,
  dailyApplicationCap: 10,
  companyApplicationCap: 3,
  companyWindowDays: 7,
  domainDelaySeconds: 30,
  updatedAt: null,
};

test("policy drafts enforce finite integer limits and bind the reviewed revision", () => {
  const draft = queueLimitsDraft(limits);
  expect(
    queueLimitsInput({ ...draft, maxConcurrentWorkers: 3 }, limits, limits).expectedRevision,
  ).toBe(1);
  for (const patch of [
    { maxConcurrentWorkers: 4 },
    { maxConcurrentWorkers: 1.5 },
    { dailyApplicationCap: 0 },
    { dailyApplicationCap: 501 },
    { companyApplicationCap: 101 },
    { companyWindowDays: 0 },
    { domainDelaySeconds: 0 },
    { domainDelaySeconds: Number.NaN },
  ])
    expect(queueLimitsDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
  expect(() => queueLimitsInput(draft, limits, { ...limits, revision: 2 })).toThrow(
    "Reload the saved limits",
  );
});

test("lost policy acknowledgement reuses the exact request while a new revision is not inferred", async () => {
  const entries = new Map<string, string>();
  const store = createQueueRequestStore({
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  });
  const input = queueLimitsInput(
    { ...queueLimitsDraft(limits), maxConcurrentWorkers: 2 },
    limits,
    limits,
  );
  const requests: string[] = [];
  const send = async (id: string) => {
    requests.push(id);
    if (requests.length === 1) throw new Error("Acknowledgement lost");
    return { ...limits, revision: 2, maxConcurrentWorkers: 2 };
  };
  await expect(
    sendQueueRequest(store, "fixture-user", ["queue-limits", input], send),
  ).rejects.toThrow("Acknowledgement lost");
  const result = await sendQueueRequest(store, "fixture-user", ["queue-limits", input], send);
  expect(requests[0]).toBe(requests[1]);
  expect(result.revision).toBe(2);
  expect(input.expectedRevision).toBe(1);
});

test("cached policy data keeps initial streamed markup stable", () => {
  const empty = new QueryClient();
  const cached = new QueryClient();
  cached.setQueryData(queryKeys.queue.limits(), limits);
  const render = (client: QueryClient) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <QueueLimitsPanel />
      </QueryClientProvider>,
    );
  expect(render(cached)).toBe(render(empty));
  expect(render(cached)).toContain("Loading queue limits");
});
