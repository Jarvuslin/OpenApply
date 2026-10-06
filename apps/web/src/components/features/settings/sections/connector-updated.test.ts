import { connectorUpdated } from "./connector-updated";
import { expect, test } from "bun:test";

test("an existing mailbox does not confirm a new connector request", () => {
  const lastSyncAt = new Date("2026-01-01T00:00:00Z");
  expect(connectorUpdated({ connected: true, provider: "connector", lastSyncAt }, lastSyncAt)).toBe(
    false,
  );
  expect(
    connectorUpdated(
      { connected: true, provider: "connector", lastSyncAt },
      "2026-01-02T00:00:00Z",
    ),
  ).toBe(false);
});

test("only a newer successful connector import confirms the request", () => {
  const current = { connected: true, provider: "connector", lastSyncAt: "2026-01-02T00:00:00Z" };
  expect(connectorUpdated(current, null)).toBe(true);
  expect(connectorUpdated(current, "2026-01-01T00:00:00Z")).toBe(true);
  expect(connectorUpdated({ ...current, provider: "gmail" }, null)).toBe(false);
  expect(connectorUpdated({ ...current, needsReauth: true }, null)).toBe(false);
  expect(connectorUpdated({ ...current, lastSyncAt: "invalid" }, null)).toBe(false);
  expect(connectorUpdated({ connected: false }, null)).toBe(false);
});
