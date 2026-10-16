import {
  type RuntimeHeartbeat,
  runtimeHeartbeatSchema,
} from "@openapply/contracts/runtime-presence";
import type { PrismaClient } from "@/generated/prisma/client";
import { RuntimePresenceService } from "./runtime-presence.service";
import { describe, expect, it } from "bun:test";

const runtimeId = "f75ccdb6-21af-40d3-b217-9fe2d7223f4e";
const heartbeat: RuntimeHeartbeat = {
  runtimeId,
  state: "ready",
  executionAvailable: true,
  blockingCode: null,
};
type Presence = RuntimeHeartbeat & { userId: string; lastSeenAt: Date };

function row(overrides: Partial<Presence> = {}): Presence {
  return { ...heartbeat, userId: "user-a", lastSeenAt: new Date(), ...overrides };
}

function fixture(initial: Presence[] = []) {
  const rows = [...initial];
  const writes: {
    where: unknown;
    create: Presence;
    update: RuntimeHeartbeat & { lastSeenAt: Date };
  }[] = [];
  const db = {
    runtimePresence: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows
          .filter((entry) => entry.userId === where.userId)
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
      upsert: async (input: (typeof writes)[number]) => {
        writes.push(input);
        rows.push(input.create);
      },
    },
  } as unknown as PrismaClient;
  return { service: new RuntimePresenceService(db), writes };
}

describe("runtime presence", () => {
  it("does not claim a computer is offline when none has been observed", async () => {
    const { service } = fixture();
    expect(await service.read("user-a")).toEqual({
      status: "unknown",
      lastSeenAt: null,
      state: null,
      executionAvailable: false,
      blockingCode: null,
    });
  });

  it.each(["ready", "stopped"] as const)(
    "treats a stale %s heartbeat as unknown",
    async (state) => {
      const lastSeenAt = new Date(Date.now() - 120_000);
      const { service } = fixture([
        row({ state, lastSeenAt, executionAvailable: state === "ready" }),
      ]);
      expect(await service.read("user-a")).toMatchObject({
        status: "unknown",
        lastSeenAt,
        executionAvailable: false,
      });
    },
  );

  it("uses offline only for a recent explicit stop", async () => {
    const { service } = fixture([row({ state: "stopped", executionAvailable: false })]);
    expect(await service.read("user-a")).toMatchObject({
      status: "offline",
      state: "stopped",
      executionAvailable: false,
    });
  });

  it("keeps presence separate from model execution availability", async () => {
    const { service } = fixture([
      row({ state: "blocked", executionAvailable: false, blockingCode: "model_approval_required" }),
    ]);
    expect(await service.read("user-a")).toMatchObject({
      status: "online",
      executionAvailable: false,
      blockingCode: "model_approval_required",
    });
  });

  it("reports an available recent runtime even when another runtime is blocked", async () => {
    const availableAt = new Date(Date.now() - 10_000);
    const { service } = fixture([
      row({ state: "blocked", executionAvailable: false, blockingCode: "budget_exhausted" }),
      row({ runtimeId: "4584cff6-1aa0-4421-9644-2f11c1202cd7", lastSeenAt: availableAt }),
    ]);
    expect(await service.read("user-a")).toMatchObject({
      status: "online",
      state: "ready",
      lastSeenAt: availableAt,
      executionAvailable: true,
      blockingCode: null,
    });
  });

  it("does not expose another account's heartbeat", async () => {
    const { service } = fixture([row({ userId: "user-b" })]);
    expect(await service.read("user-a")).toMatchObject({ status: "unknown", lastSeenAt: null });
  });

  it.each(["session_user", "telegram_user"] as const)(
    "does not allow %s to claim runtime presence",
    async (authKind) => {
      const { service, writes } = fixture();
      await expect(service.heartbeat("user-a", heartbeat, authKind)).rejects.toMatchObject({
        status: 403,
      });
      expect(writes).toEqual([]);
    },
  );

  it("records agent heartbeats using the authenticated account and server time", async () => {
    const { service, writes } = fixture();
    const start = Date.now();
    expect(await service.heartbeat("user-a", heartbeat, "agent")).toMatchObject({
      status: "online",
      executionAvailable: true,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].where).toEqual({ userId_runtimeId: { userId: "user-a", runtimeId } });
    expect(writes[0].create.userId).toBe("user-a");
    expect(writes[0].create.lastSeenAt.getTime()).toBeGreaterThanOrEqual(start);
    expect(writes[0].create.lastSeenAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects client timestamps and contradictory execution claims before writing", async () => {
    const { service, writes } = fixture();
    const raw = { ...heartbeat, lastSeenAt: new Date(Date.now() + 86_400_000) };
    await expect(service.heartbeat("user-a", raw, "agent")).rejects.toThrow();
    for (const value of [
      { ...heartbeat, state: "stopped" },
      { ...heartbeat, state: "blocked" },
      { ...heartbeat, blockingCode: "budget_exhausted" },
    ])
      expect(runtimeHeartbeatSchema.safeParse(value).success).toBe(false);
    expect(writes).toEqual([]);
  });
});
