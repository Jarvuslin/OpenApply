import type { QueueCompanionStatus } from "@/lib/queue-companion";
import { queueConnectionState } from "./connection-state";
import { expect, test } from "bun:test";

const ready: QueueCompanionStatus = {
  connectionId: "22222222-2222-4222-8222-222222222222",
  ownerId: "11111111-1111-4111-8111-111111111111",
  connected: true,
  running: false,
  blockingReason: null,
  lastError: null,
  configuredCapacity: 1,
  effectiveCapacity: 1,
  workers: [],
  budget: { enabled: true, remainingAllocations: 1, reason: null },
};
test("unreachable is unknown, not a claim that the computer is offline", () => {
  expect(queueConnectionState({ pending: false, error: true, status: ready })).toMatchObject({
    label: "Connection unavailable",
  });
});
test("ready requires a current account connection, capacity and approved budget", () => {
  expect(queueConnectionState({ pending: false, error: false, status: ready }).detail).toBe(
    "Connected · ready",
  );
  for (const patch of [
    { effectiveCapacity: 0 },
    { budget: { enabled: false, remainingAllocations: 0, reason: "Approval required" } },
  ])
    expect(
      queueConnectionState({ pending: false, error: false, status: { ...ready, ...patch } }).detail,
    ).toBe("Execution is blocked");
  expect(queueConnectionState({ pending: false, error: false }).label).toBe("Not connected");
});
test("error is shown even if the last cached response indicated work", () => {
  expect(
    queueConnectionState({
      pending: false,
      error: false,
      status: { ...ready, running: true, lastError: "worker unavailable" },
    }).label,
  ).toBe("Computer needs attention");
});
test("an idle queue with no pre-approved runs is still ready", () => {
  expect(
    queueConnectionState({
      pending: false,
      error: false,
      status: { ...ready, budget: { enabled: true, remainingAllocations: 0, reason: null } },
    }).detail,
  ).toBe("Connected · ready");
});
