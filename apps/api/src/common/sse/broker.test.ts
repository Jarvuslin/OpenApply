import { createSseBroker } from "./broker";
import { describe, expect, test } from "bun:test";

describe("SSE subscriber backpressure", () => {
  test("a stalled subscriber closes instead of retaining an unbounded backlog", async () => {
    const broker = createSseBroker({ heartbeatMs: 0, retentionMs: 0 });
    const slow = broker.subscribe("owner");
    await slow.next();
    for (let index = 0; index < 10_000; index++) broker.publish("owner", { index });
    expect((await slow.next()).done).toBe(true);
  });

  test("the exact pending boundary delivers in order without closing", async () => {
    const broker = createSseBroker({ heartbeatMs: 0, pendingLimit: 2, retentionMs: 0 });
    const stream = broker.subscribe("owner");
    await stream.next();
    broker.publish("owner", "first");
    broker.publish("owner", "second");
    const first = await stream.next();
    const second = await stream.next();
    expect(first.done).toBe(false);
    expect(second.done).toBe(false);
    expect(JSON.stringify(first.value)).toContain("first");
    expect(JSON.stringify(second.value)).toContain("second");
    await stream.return();
  });

  test("one slow subscriber does not interrupt a healthy subscriber or another owner", async () => {
    const broker = createSseBroker({ heartbeatMs: 0, pendingLimit: 2, retentionMs: 0 });
    const slow = broker.subscribe("owner");
    const healthy = broker.subscribe("owner");
    const other = broker.subscribe("another-owner");
    await Promise.all([slow.next(), healthy.next(), other.next()]);
    for (let index = 0; index < 10; index++) {
      broker.publish("owner", { index });
      expect((await healthy.next()).done).toBe(false);
    }
    expect((await slow.next()).done).toBe(true);
    broker.publish("another-owner", "separate");
    expect(JSON.stringify((await other.next()).value)).toContain("separate");
    await Promise.all([healthy.return(), other.return()]);
  });

  test("reconnect can still replay the retained latest event after overflow", async () => {
    const broker = createSseBroker({ heartbeatMs: 0, pendingLimit: 2, retentionMs: 1000 });
    const slow = broker.subscribe("owner");
    await slow.next();
    for (let index = 1; index <= 3; index++) broker.publish("owner", { index });
    expect((await slow.next()).done).toBe(true);
    const resumed = broker.subscribe("owner", 2);
    await resumed.next();
    expect(JSON.stringify((await resumed.next()).value)).toContain('"index":3');
    await resumed.return();
  });

  test("normal cancellation detaches a suspended stream", async () => {
    const broker = createSseBroker({ heartbeatMs: 5, pendingLimit: 2, retentionMs: 0 });
    const stream = broker.subscribe("owner");
    await stream.next();
    await stream.return();
    for (let index = 0; index < 10; index++) broker.publish("owner", { index });
    expect((await stream.next()).done).toBe(true);
  });

  test("invalid pending bounds cannot silently disable the safeguard", () => {
    for (const pendingLimit of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => createSseBroker({ pendingLimit })).toThrow(RangeError);
    }
  });
});
