import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { TelegramConfigHolder } from "./telegram.config";

// biome-ignore lint/suspicious/noExplicitAny: This stateful Prisma test double models several generated row shapes.
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part: Row) => matches(row, part));
    if (key === "AND") return value.every((part: Row) => matches(row, part));
    if (!(key in row) && value && typeof value === "object") return matches(row, value);
    const actual = row[key];
    if (value instanceof Date)
      return actual instanceof Date && actual.getTime() === value.getTime();
    if (value && typeof value === "object")
      return Object.entries(value).every(([op, v]) =>
        op === "in"
          ? (v as unknown[]).includes(actual)
          : op === "lt"
            ? actual < (v as Date)
            : op === "lte"
              ? actual <= (v as Date)
              : op === "gt"
                ? actual > (v as Date)
                : op === "not"
                  ? actual !== v
                  : false,
      );
    return actual === value;
  });
}
function change(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data))
    row[key] =
      value === Prisma.DbNull
        ? null
        : value && typeof value === "object" && "increment" in value
          ? row[key] + value.increment
          : value;
  return structuredClone(row);
}
export function telegramFake() {
  const tables: Record<string, Row[]> = {};
  const prisma: Row = { $executeRaw: async () => 0, $queryRaw: async () => [] };
  for (const table of [
    "telegramLink",
    "telegramSettings",
    "telegramSettingRequest",
    "telegramPairing",
    "telegramUpdate",
    "telegramAction",
    "telegramDelivery",
    "telegramSenderEvent",
  ]) {
    const rows: Row[] = [];
    tables[table] = rows;
    const find = (input: Row) => {
      let result = rows.filter((row) => matches(row, input.where));
      for (const sort of (Array.isArray(input.orderBy)
        ? input.orderBy
        : input.orderBy
          ? [input.orderBy]
          : []
      ).toReversed()) {
        const [key, direction] = Object.entries(sort)[0]!;
        result = result.toSorted(
          (a, b) =>
            (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === "desc" ? -1 : 1),
        );
      }
      return result.slice(
        input.skip ?? 0,
        input.take === undefined ? undefined : (input.skip ?? 0) + input.take,
      );
    };
    const create = async ({ data }: Row) => {
      const row = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        attempts: 0,
        state: "pending",
        processingAt: null,
        completedAt: null,
        sendingAt: null,
        availableAt: new Date(),
        expectedHash: null,
        expectedRevision: null,
        consumedAt: null,
        cancelledAt: null,
        ...data,
      };
      rows.push(row);
      return structuredClone(row);
    };
    prisma[table] = {
      findFirst: async (input: Row) => structuredClone(find(input)[0] ?? null),
      findUnique: async (input: Row) => structuredClone(find(input)[0] ?? null),
      findMany: async (input: Row) => structuredClone(find(input)),
      count: async (input: Row) => find(input).length,
      create,
      update: async ({ where, data }: Row) => {
        const row = rows.find((row) => matches(row, where));
        if (!row) throw Error("Missing synthetic row");
        return change(row, data);
      },
      updateMany: async ({ where, data }: Row) => {
        const matched = rows.filter((row) => matches(row, where));
        for (const row of matched) change(row, data);
        return { count: matched.length };
      },
      upsert: async ({ where, create: data, update }: Row) => {
        const row = rows.find((row) => matches(row, where));
        return row ? change(row, update) : create({ data });
      },
    };
  }
  let tail = Promise.resolve();
  prisma.$transaction = async (callback: (tx: Row) => Promise<unknown>) => {
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await callback(prisma);
    } finally {
      unlock();
    }
  };
  const userId = crypto.randomUUID();
  tables.telegramSettings!.push({
    userId,
    revision: 1,
    digestEnabled: false,
    digestHour: 17,
    timeZone: "UTC",
    quietHours: null,
  });
  return {
    prisma: prisma as PrismaClient,
    tables,
    userId,
    link: () => {
      const link = {
        id: crypto.randomUUID(),
        userId,
        generation: 1,
        active: true,
        senderId: "42",
        chatId: "42",
        linkedAt: new Date(),
      };
      tables.telegramLink!.push(link);
      return link;
    },
  };
}
export const telegramTestConfig: TelegramConfigHolder = {
  telegram: {
    botToken: "123:synthetic-only",
    botUsername: "synthetic_bot",
    webhookSecret: "synthetic-webhook-secret-for-local-tests",
    pairingKey: "synthetic-pairing-key-for-local-tests-only",
    updates: "webhook",
    deliveryEnabled: false,
    webUrl: "https://openapply.example",
  },
};
