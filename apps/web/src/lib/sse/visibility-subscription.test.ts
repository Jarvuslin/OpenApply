import { subscribeWhileVisible } from "./visibility-subscription";
import { describe, expect, test } from "bun:test";

class FakeVisibility {
  visibilityState = "visible";
  listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }

  change(state: string) {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }
}

function createSubscription() {
  let acquired = 0;
  let released = 0;
  let hidden = 0;
  let resources = 0;
  return {
    acquire: () => {
      acquired += 1;
      resources += 1;
      return () => {
        released += 1;
        resources -= 1;
      };
    },
    onHidden: () => {
      hidden += 1;
    },
    counts: () => ({ acquired, released, hidden, resources }),
  };
}

describe("visible SSE subscription lifecycle", () => {
  test("does not connect in a hidden tab and acquires only once when shown", () => {
    const visibility = new FakeVisibility();
    visibility.visibilityState = "hidden";
    const subscription = createSubscription();
    const dispose = subscribeWhileVisible(visibility, subscription.acquire, subscription.onHidden);

    expect(subscription.counts()).toEqual({ acquired: 0, released: 0, hidden: 1, resources: 0 });
    visibility.change("visible");
    visibility.change("visible");
    expect(subscription.counts()).toEqual({ acquired: 1, released: 0, hidden: 1, resources: 1 });
    dispose();
    expect(subscription.counts().resources).toBe(0);
  });

  test("releases on hide, reconnects once on return, and cleans up idempotently", () => {
    const visibility = new FakeVisibility();
    const subscription = createSubscription();
    const dispose = subscribeWhileVisible(visibility, subscription.acquire, subscription.onHidden);
    const queuedListener = [...visibility.listeners][0];

    visibility.change("hidden");
    visibility.change("hidden");
    expect(subscription.counts().released).toBe(1);
    expect(subscription.counts().resources).toBe(0);
    visibility.change("visible");
    expect(subscription.counts().acquired).toBe(2);
    expect(subscription.counts().resources).toBe(1);

    dispose();
    dispose();
    queuedListener?.();
    visibility.change("visible");
    expect(visibility.listeners.size).toBe(0);
    expect(subscription.counts().acquired).toBe(2);
    expect(subscription.counts().released).toBe(2);
    expect(subscription.counts().resources).toBe(0);
  });

  test("disposing while hidden cannot reopen a subscription", () => {
    const visibility = new FakeVisibility();
    const subscription = createSubscription();
    const dispose = subscribeWhileVisible(visibility, subscription.acquire, subscription.onHidden);

    visibility.change("hidden");
    dispose();
    visibility.change("visible");
    expect(visibility.listeners.size).toBe(0);
    expect(subscription.counts().acquired).toBe(1);
    expect(subscription.counts().released).toBe(1);
  });

  test("every subscriber releases its shared resource reference while hidden", () => {
    const visibility = new FakeVisibility();
    const subscription = createSubscription();
    const disposeFirst = subscribeWhileVisible(
      visibility,
      subscription.acquire,
      subscription.onHidden,
    );
    const disposeSecond = subscribeWhileVisible(
      visibility,
      subscription.acquire,
      subscription.onHidden,
    );

    expect(subscription.counts().resources).toBe(2);
    visibility.change("hidden");
    expect(subscription.counts().resources).toBe(0);
    disposeFirst();
    visibility.change("visible");
    expect(subscription.counts().resources).toBe(1);
    disposeSecond();
    expect(subscription.counts().resources).toBe(0);
  });
});
