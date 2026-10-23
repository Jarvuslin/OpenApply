import {
  type RuntimeHeartbeat,
  runtimeHeartbeatSchema,
  runtimePresenceSchema,
} from "@openapply/contracts/runtime-presence";
import { singleton } from "tsyringe";
import { forbidden } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { PrismaClient } from "@/generated/prisma/client";

@singleton()
export class RuntimePresenceService {
  constructor(private readonly prisma: PrismaClient) {}
  async heartbeat(userId: string, raw: RuntimeHeartbeat, authKind: AuthKind) {
    if (authKind !== "agent")
      throw forbidden("Runtime presence requires a local agent credential.");
    const input = runtimeHeartbeatSchema.parse(raw);
    await this.prisma.runtimePresence.upsert({
      where: { userId_runtimeId: { userId, runtimeId: input.runtimeId } },
      create: { userId, ...input, lastSeenAt: new Date() },
      update: { ...input, lastSeenAt: new Date() },
    });
    return this.read(userId);
  }
  async read(userId: string) {
    const rows = await this.prisma.runtimePresence.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    });
    const recent = rows.filter(
      (row) => row.lastSeenAt.getTime() > Date.now() - 90_000 && row.state !== "stopped",
    );
    const current = recent.find((row) => row.executionAvailable) ?? recent[0] ?? rows[0];
    return runtimePresenceSchema.parse({
      status: recent.length
        ? "online"
        : current?.state === "stopped" && current.lastSeenAt.getTime() > Date.now() - 90_000
          ? "offline"
          : "unknown",
      lastSeenAt: current?.lastSeenAt ?? null,
      state: current?.state ?? null,
      executionAvailable: !!recent.length && current?.executionAvailable === true,
      blockingCode: current?.blockingCode ?? null,
    });
  }
}
