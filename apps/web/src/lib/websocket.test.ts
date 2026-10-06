import { connectWebSocket } from "./websocket";
import { afterEach, describe, expect, test } from "bun:test";

const originalWebSocket = globalThis.WebSocket;
class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  binaryType = "";
  closes = 0;
  constructor() {
    super();
    FakeSocket.last = this;
  }
  close() {
    this.closes++;
    this.readyState = 3;
  }
  send() {}
}
afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe("terminal WebSocket handshake", () => {
  test("a stalled connection reports failure and closes the socket", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const failed = Promise.withResolvers<void>();
    connectWebSocket("ws://localhost/test", {
      connectTimeoutMs: 10,
      onError: () => failed.resolve(),
    });
    await failed.promise;
    expect(FakeSocket.last.closes).toBe(1);
  });

  test("open or unmount clears the deadline without a late failure", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    let errors = 0;
    const opened = connectWebSocket("ws://localhost/test", {
      connectTimeoutMs: 10,
      onError: () => {
        errors++;
      },
    });
    FakeSocket.last.dispatchEvent(new Event("open"));
    const unmounted = connectWebSocket("ws://localhost/test", {
      connectTimeoutMs: 10,
      onError: () => {
        errors++;
      },
    });
    unmounted.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(errors).toBe(0);
    opened.close();
  });
});
