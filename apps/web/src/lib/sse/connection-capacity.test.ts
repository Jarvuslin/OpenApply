import { type ConnectionStatus, createSharedTransport } from "./shared-transport";
import { eventually, TransportFixture } from "./transport-fakes";
import { expect, test } from "bun:test";

function watcher() {
  const statuses: ConnectionStatus[] = [];
  return {
    statuses,
    listener: {
      message: () => {},
      error: () => {},
      status: (value: ConnectionStatus) => statuses.push(value),
    },
  };
}

test("real queue and Pilot channels occupy both free slots without rotating", async () => {
  const fixture = new TransportFixture();
  const transport = createSharedTransport(fixture.platform());
  const queue = watcher();
  const pilot = watcher();
  transport.subscribe("http://localhost:4101/api/work-queue/events", queue.listener);
  transport.subscribe("http://localhost:4101/api/pilot/events", pilot.listener);
  try {
    await eventually(() => fixture.sources.length >= 2);
    expect(fixture.open()).toHaveLength(2);
    for (const source of fixture.open()) source.connected();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.sources).toHaveLength(2);
    expect(queue.statuses.at(-1)).toBe("open");
    expect(pilot.statuses.at(-1)).toBe("open");
  } finally {
    transport.dispose();
  }
  await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
});

test("scheduled capacity rotation reports waiting without inventing network failures", async () => {
  const fixture = new TransportFixture();
  const transport = createSharedTransport(fixture.platform());
  const watchers = [watcher(), watcher(), watcher()];
  const paths = ["work-queue", "pilot", "workspace"];
  for (const [index, observer] of watchers.entries()) {
    transport.subscribe(`http://localhost:4101/api/${paths[index]}/events`, observer.listener);
  }
  try {
    await eventually(() => fixture.sources.length >= 4);
    expect(watchers.flatMap((item) => item.statuses)).toContain("waiting");
    expect(watchers.flatMap((item) => item.statuses)).not.toContain("reconnecting");
    expect(fixture.maxOpen).toBe(2);
  } finally {
    transport.dispose();
  }
  await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
});

test("a real connection failure stays visible through rotation until the stream opens", async () => {
  const fixture = new TransportFixture();
  const transport = createSharedTransport(fixture.platform());
  const queue = watcher();
  const url = "http://localhost:4101/api/work-queue/events";
  transport.subscribe(url, queue.listener);
  try {
    await eventually(() => fixture.open().length === 1);
    const first = fixture.open()[0]!;
    first.connected();
    first.onerror?.();
    transport.subscribe("http://localhost:4101/api/pilot/events", watcher().listener);
    transport.subscribe("http://localhost:4101/api/workspace/events", watcher().listener);
    await eventually(() => fixture.sources.filter((source) => source.url === url).length === 2);
    expect(queue.statuses.at(-1)).toBe("reconnecting");
    fixture.sources
      .filter((source) => source.url === url)
      .at(-1)!
      .connected();
    expect(queue.statuses.at(-1)).toBe("open");
  } finally {
    transport.dispose();
  }
  await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
});
