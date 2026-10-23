import {
  type ConnectionStatus,
  createSharedTransport,
  type StreamMessage,
} from "./shared-transport";
import { eventually, TransportFixture } from "./transport-fakes";
import { describe, expect, test } from "bun:test";

function observer() {
  const messages: StreamMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  let errors = 0;
  return {
    messages,
    statuses,
    errors: () => errors,
    listener: {
      message: (event: StreamMessage) => messages.push(event),
      status: (status: ConnectionStatus) => statuses.push(status),
      error: () => {
        errors++;
      },
    },
  };
}

describe("cross-tab bounded SSE transport", () => {
  test("visible tabs share one upstream and receive messages, status and errors", async () => {
    const fixture = new TransportFixture();
    const first = observer();
    const second = observer();
    const url = "http://localhost:4101/api/work-queue/events";
    const releaseFirst = createSharedTransport(fixture.platform()).subscribe(url, first.listener);
    const releaseSecond = createSharedTransport(fixture.platform()).subscribe(url, second.listener);
    try {
      await eventually(() => fixture.open().length > 0);
      expect(fixture.open()).toHaveLength(1);
      const source = fixture.open()[0]!;
      source.connected();
      source.message('{"type":"work-queue.changed"}', "42");
      source.onerror?.();
      await eventually(() => second.messages.length === 1 && second.errors() === 1);
      expect(first.messages).toEqual(second.messages);
      expect(second.statuses).toContain("open");
      expect(second.statuses.at(-1)).toBe("reconnecting");
    } finally {
      releaseFirst();
      releaseSecond();
    }
    await eventually(() => fixture.locks.active.size === 0);
  });

  test("eight distinct streams never exceed two connections and every stream gets a turn", async () => {
    const fixture = new TransportFixture();
    const releases = Array.from({ length: 8 }, (_, index) =>
      createSharedTransport(fixture.platform()).subscribe(
        `http://localhost:4101/api/campaigns/${index}/events`,
        observer().listener,
      ),
    );
    try {
      await eventually(() => new Set(fixture.sources.map((source) => source.url)).size === 8);
      expect(fixture.maxOpen).toBeLessThanOrEqual(2);
    } finally {
      for (const release of releases) release();
    }
    await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
    expect(fixture.open()).toHaveLength(0);
  });

  test("owner teardown transfers the latest event cursor to the next tab", async () => {
    const fixture = new TransportFixture();
    const url = "http://localhost:4101/api/work-queue/events";
    const releaseFirst = createSharedTransport(fixture.platform()).subscribe(
      url,
      observer().listener,
    );
    const second = observer();
    const releaseSecond = createSharedTransport(fixture.platform()).subscribe(url, second.listener);
    try {
      await eventually(() => fixture.open().length > 0);
      fixture.open()[0]!.message("saved", "81");
      await eventually(() => second.messages.length > 0);
      releaseFirst();
      await eventually(() => fixture.sources.length === 2);
      expect(fixture.open()).toHaveLength(1);
      expect(fixture.open()[0]!.cursor).toBe("81");
    } finally {
      releaseFirst();
      releaseSecond();
    }
    await eventually(() => fixture.locks.active.size === 0);
  });

  test("local refcounts close only after the last panel unsubscribes", async () => {
    const fixture = new TransportFixture();
    const transport = createSharedTransport(fixture.platform());
    const first = transport.subscribe(
      "http://localhost:4101/api/work-queue/events",
      observer().listener,
    );
    const second = transport.subscribe(
      "http://localhost:4101/api/work-queue/events",
      observer().listener,
    );
    await eventually(() => fixture.open().length === 1);
    first();
    expect(fixture.open()).toHaveLength(1);
    second();
    second();
    await eventually(() => fixture.locks.active.size === 0);
    expect(fixture.open()).toHaveLength(0);
    expect([...fixture.channels.values()].every((members) => members.size === 0)).toBe(true);
  });

  test("slot rotation reconnects with the latest cursor and delivers replay to followers", async () => {
    const fixture = new TransportFixture();
    const firstUrl = "http://localhost:4101/api/campaigns/0/events";
    const competingUrl = "http://localhost:4101/api/campaigns/2/events";
    const first = observer();
    const follower = observer();
    const releases = [
      createSharedTransport(fixture.platform()).subscribe(firstUrl, first.listener),
      createSharedTransport(fixture.platform()).subscribe(firstUrl, follower.listener),
    ];
    try {
      await eventually(() => fixture.open().length === 1);
      fixture.open()[0]!.message("before rotation", "14");
      await eventually(() => follower.messages.length === 1);
      releases.push(
        createSharedTransport(fixture.platform()).subscribe(competingUrl, observer().listener),
        createSharedTransport(fixture.platform()).subscribe(
          "http://localhost:4101/api/workspace/events",
          observer().listener,
        ),
      );
      await eventually(
        () => fixture.sources.filter((source) => source.url === firstUrl).length === 2,
      );
      const resumed = fixture.sources.filter((source) => source.url === firstUrl).at(-1)!;
      expect(resumed.cursor).toBe("14");
      resumed.message("replayed during gap", "15");
      await eventually(() => follower.messages.length === 2);
      expect(first.messages).toEqual(follower.messages);
      expect(fixture.maxOpen).toBeLessThanOrEqual(2);
    } finally {
      for (const release of releases) release();
    }
    await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
  });

  test("a tab removed while waiting for ownership never starts later", async () => {
    const fixture = new TransportFixture();
    const url = "http://localhost:4101/api/work-queue/events";
    const first = createSharedTransport(fixture.platform()).subscribe(url, observer().listener);
    const second = createSharedTransport(fixture.platform()).subscribe(url, observer().listener);
    await eventually(() => fixture.open().length === 1 && fixture.locks.pending.length === 1);
    second();
    first();
    await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
    expect(fixture.sources).toHaveLength(1);
    expect(fixture.open()).toHaveLength(0);
  });

  test("different URLs never receive each other's payloads", async () => {
    const fixture = new TransportFixture();
    const first = observer();
    const second = observer();
    const firstUrl = "http://localhost:4101/api/work-queue/events";
    const releases = [
      createSharedTransport(fixture.platform()).subscribe(firstUrl, first.listener),
      createSharedTransport(fixture.platform()).subscribe(
        "http://another-api.test/api/work-queue/events",
        second.listener,
      ),
    ];
    try {
      await eventually(() => fixture.open().length === 2);
      fixture
        .open()
        .find((source) => source.url === firstUrl)!
        .message("private to this API", "5");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(first.messages).toHaveLength(1);
      expect(second.messages).toHaveLength(0);
    } finally {
      for (const release of releases) release();
    }
    await eventually(() => fixture.locks.active.size === 0);
  });

  test("fatal source errors redial with the saved cursor", async () => {
    const fixture = new TransportFixture();
    const release = createSharedTransport(fixture.platform()).subscribe(
      "http://localhost:4101/api/work-queue/events",
      observer().listener,
    );
    try {
      await eventually(() => fixture.open().length === 1);
      const source = fixture.open()[0]!;
      source.message("saved", "92");
      source.close();
      source.onerror?.();
      await new Promise((resolve) => setTimeout(resolve, 2050));
      await eventually(() => fixture.sources.length === 2);
      expect(fixture.open()[0]!.cursor).toBe("92");
    } finally {
      release();
    }
    await eventually(() => fixture.locks.active.size === 0);
  });

  test("session reset closes active and queued streams and ignores late private frames", async () => {
    const fixture = new TransportFixture();
    const firstTab = createSharedTransport(fixture.platform());
    const secondTab = createSharedTransport(fixture.platform());
    const owner = observer();
    const follower = observer();
    firstTab.subscribe("http://localhost:4101/api/work-queue/events", owner.listener);
    secondTab.subscribe("http://localhost:4101/api/work-queue/events", follower.listener);
    for (let index = 0; index < 8; index++) {
      firstTab.subscribe(
        `http://localhost:4101/api/campaigns/${index}/events`,
        observer().listener,
      );
    }
    await eventually(() => fixture.open().length > 0 && fixture.locks.pending.length > 1);
    const stale = fixture.sources.find((source) => source.url.endsWith("/work-queue/events"))!;
    stale.message("queued before reset", "101");
    const receivedBeforeReset = owner.messages.length;
    firstTab.dispose();
    secondTab.dispose();
    stale.message("must not reach either account", "102");
    stale.onopen?.();
    await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
    expect(fixture.open()).toHaveLength(0);
    expect(follower.messages).toHaveLength(0);
    expect(owner.messages).toHaveLength(receivedBeforeReset);
    expect([...fixture.channels.values()].every((members) => members.size === 0)).toBe(true);
  });

  test("different confirmed users cannot share a stream or its replay cursor", async () => {
    const fixture = new TransportFixture();
    const oldAccount = createSharedTransport(fixture.platform(10, "old-user"));
    const newAccount = createSharedTransport(fixture.platform(10, "new-user"));
    const oldObserver = observer();
    const newObserver = observer();
    const url = "http://localhost:4101/api/work-queue/events";
    oldAccount.subscribe(url, oldObserver.listener);
    await eventually(() => fixture.sources.length === 1);
    fixture.sources[0]!.message("old account", "88");
    newAccount.subscribe(url, newObserver.listener);
    await eventually(() => fixture.sources.length >= 2);
    expect(fixture.sources[1]!.cursor).toBe("0");
    expect(newObserver.messages).toHaveLength(0);
    oldAccount.dispose();
    newAccount.dispose();
    await eventually(() => fixture.locks.active.size === 0 && fixture.locks.pending.length === 0);
  });

  test("teardown cancels a pending fatal redial", async () => {
    const fixture = new TransportFixture();
    const transport = createSharedTransport(fixture.platform());
    const release = transport.subscribe(
      "http://localhost:4101/api/work-queue/events",
      observer().listener,
    );
    await eventually(() => fixture.open().length === 1);
    const stale = fixture.open()[0]!;
    stale.close();
    stale.onerror?.();
    release();
    await eventually(() => fixture.locks.active.size === 0);
    await new Promise((resolve) => setTimeout(resolve, 2050));
    expect(fixture.sources).toHaveLength(1);
    expect(fixture.open()).toHaveLength(0);
  });
});
