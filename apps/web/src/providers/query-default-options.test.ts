import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { queryDefaultOptions } from "./query-default-options";
import { expect, test } from "bun:test";

test("returning to a visible tab refreshes fresh active data but not disabled or inactive queries", async () => {
  const client = new QueryClient({ defaultOptions: queryDefaultOptions });
  client.mount();
  focusManager.setFocused(true);
  let activeCalls = 0;
  let disabledCalls = 0;
  let inactiveCalls = 0;
  const refreshed = Promise.withResolvers<void>();
  const active = new QueryObserver(client, {
    queryKey: ["visible-catch-up"],
    queryFn: async () => ++activeCalls,
    initialData: 0,
  });
  const disabled = new QueryObserver(client, {
    queryKey: ["disabled-catch-up"],
    queryFn: async () => ++disabledCalls,
    initialData: 0,
    enabled: false,
  });
  const inactive = new QueryObserver(client, {
    queryKey: ["inactive-catch-up"],
    queryFn: async () => ++inactiveCalls,
    initialData: 0,
  });
  const unsubscribeActive = active.subscribe((result) => {
    if (result.data === 1 && !result.isFetching) refreshed.resolve();
  });
  const unsubscribeDisabled = disabled.subscribe(() => {});

  try {
    expect(active.getCurrentResult().isStale).toBe(false);
    expect(activeCalls).toBe(0);
    focusManager.setFocused(false);
    expect(activeCalls).toBe(0);
    focusManager.setFocused(true);
    await refreshed.promise;
    expect(activeCalls).toBe(1);
    expect(disabledCalls).toBe(0);
    expect(inactiveCalls).toBe(0);
    expect(inactive.getCurrentResult().data).toBe(0);
  } finally {
    unsubscribeActive();
    unsubscribeDisabled();
    inactive.destroy();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
  }
});
