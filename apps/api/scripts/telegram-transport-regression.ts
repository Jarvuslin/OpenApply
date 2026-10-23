import "reflect-metadata";
import assert from "node:assert/strict";
import { assertHumanActor } from "../src/common/auth/human-actor";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import type { TelegramConfigHolder } from "../src/modules/telegram/telegram.config";
import type { TelegramDomain } from "../src/modules/telegram/telegram.domain";
import { TelegramInbound } from "../src/modules/telegram/telegram.inbound";
import { enqueueTelegramNotice } from "../src/modules/telegram/telegram.notice";
import { TelegramOutbox } from "../src/modules/telegram/telegram.outbox";
import { actionToken } from "../src/modules/telegram/telegram.policy";
import { TelegramService } from "../src/modules/telegram/telegram.service";
import type { TelegramTransport } from "../src/modules/telegram/telegram.transport";
import { lockWorkUser } from "../src/modules/work-queue/work-queue.admission";
import { telegramFixture } from "./telegram-regression-fixtures";

export async function verifyTelegramTransport(db: PrismaClient) {
  const checks: string[] = [],
    owners: string[] = [];
  let fakeTransportCalls = 0;
  const config: TelegramConfigHolder = {
    telegram: {
      botToken: "123:synthetic-regression-only",
      botUsername: "synthetic_bot",
      webhookSecret: "synthetic-regression-webhook-secret-never-external",
      pairingKey: "synthetic-regression-pairing-key-never-external",
      updates: "webhook",
      deliveryEnabled: false,
      webUrl: "https://openapply.example",
    },
  };
  let updateId = Date.now() * 100;
  const sender = Number(BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`)) + 1;
  const message = (text: string) => ({
    update_id: updateId++,
    message: {
      message_id: updateId,
      from: { id: sender, is_bot: false },
      chat: { id: sender, type: "private" },
      text,
    },
  });
  const effects = new Set<string>(),
    requestIds: string[] = [];
  const domain = {
    status: async () => ({
      queued: 2,
      running: 0,
      needsYou: 1,
      presence: "unknown",
      executionAvailable: false,
      lastSeenAt: null,
    }),
    notices: async () => ({ notices: [], hasMore: false }),
    noticeCurrent: async () => true,
    current: async () => true,
    execute: async (action: {
      userId: string;
      linkId: string;
      generation: number;
      requestId: string;
      id: string;
    }) => {
      await db.$transaction(async (tx) => {
        await lockWorkUser(tx, action.userId);
        await assertHumanActor(tx, action.userId, {
          kind: "telegram_user",
          linkId: action.linkId,
          generation: action.generation,
        });
      });
      requestIds.push(action.requestId);
      effects.add(action.requestId);
      return { eventKey: `action:${action.id}`, template: "action_done" };
    },
  } as unknown as TelegramDomain;
  const transport = {
    send: async () => {
      fakeTransportCalls++;
      return { state: "unknown", code: "transport_unknown" };
    },
  } as unknown as TelegramTransport;
  const service = new TelegramService(db, config),
    inbound = new TelegramInbound(db, domain, transport, config);
  const outbox = new TelegramOutbox(db, domain, transport, {
    telegram: { ...config.telegram!, deliveryEnabled: true },
  });
  try {
    assert.equal(
      await db.telegramUpdate.count({ where: { state: { in: ["pending", "processing"] } } }),
      0,
      "Transport regression requires a quiescent synthetic inbound queue.",
    );
    assert.equal(
      await db.telegramDelivery.count({ where: { state: { in: ["pending", "sending"] } } }),
      0,
      "Transport regression requires a quiescent synthetic outbox.",
    );
    const f = await telegramFixture("TelegramTransport");
    owners.push(f.user.id);
    const pairingRequest = crypto.randomUUID(),
      pair = await service.pair(f.user.id, pairingRequest, "session_user");
    const stored = await db.telegramPairing.findUniqueOrThrow({ where: { id: pair.pairingId } });
    assert.notEqual(stored.codeHash, pair.code);
    assert.equal(stored.codeHash.length, 64);
    await assert.rejects(service.pair(f.user.id, pairingRequest, "session_user"));
    await assert.rejects(service.pair(f.user.id, crypto.randomUUID(), "agent"));
    const start = message(`/start ${pair.code}`);
    await inbound.accept({
      ...start,
      message: { ...start.message, chat: { ...start.message.chat, type: "group" } },
    });
    assert.equal(await db.telegramLink.count({ where: { userId: f.user.id } }), 0);
    await inbound.accept(start);
    await inbound.accept(start);
    const link = await db.telegramLink.findFirstOrThrow({
      where: { userId: f.user.id, active: true },
    });
    assert.equal(await db.telegramDelivery.count({ where: { linkId: link.id } }), 1);
    checks.push("private one-use pairing stores only a hash and durably deduplicates updates");
    await db.$transaction(async (tx) => {
      await lockWorkUser(tx, f.user.id);
      await assert.rejects(assertHumanActor(tx, f.user.id, "telegram_user"));
      await assert.rejects(
        assertHumanActor(tx, crypto.randomUUID(), {
          kind: "telegram_user",
          linkId: link.id,
          generation: link.generation,
        }),
      );
    });
    const action = await db.telegramAction.create({
      data: {
        userId: f.user.id,
        linkId: link.id,
        generation: link.generation,
        eventKey: "fixture-action",
        kind: "queue",
        targetId: crypto.randomUUID(),
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        payload: {},
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const callback = {
      update_id: updateId++,
      callback_query: {
        id: crypto.randomUUID(),
        from: { id: sender, is_bot: false },
        message: message("/status").message,
        data: actionToken(action, config.telegram!.webhookSecret),
      },
    };
    await inbound.accept({
      ...callback,
      callback_query: {
        ...callback.callback_query,
        data: `${callback.callback_query.data.slice(0, -1)}!`,
      },
    });
    assert.equal(
      await db.telegramUpdate.count({ where: { userId: f.user.id, state: "pending" } }),
      0,
    );
    await inbound.accept(callback);
    await inbound.accept({ ...callback, update_id: updateId++ });
    assert.equal(
      await db.telegramUpdate.count({ where: { userId: f.user.id, state: "pending" } }),
      1,
    );
    await inbound.processOne();
    await inbound.accept({
      ...callback,
      update_id: updateId++,
      callback_query: { ...callback.callback_query, id: crypto.randomUUID() },
    });
    await inbound.processOne();
    assert.equal(requestIds.length, 1);
    assert.equal(effects.size, 1);
    checks.push("opaque owner-bound callback identity and action state prevent duplicate effects");
    const settingsInput = {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      digestEnabled: true,
      digestHour: 0,
      timeZone: "UTC",
      quietHours: null,
    };
    assert.deepEqual(
      await service.settings(f.user.id, settingsInput, "session_user"),
      await service.settings(f.user.id, settingsInput, "session_user"),
    );
    const now = new Date(),
      minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    await db.telegramSettings.update({
      where: { userId: f.user.id },
      data: { quietHours: { startMinute: minute, endMinute: (minute + 1) % 1440 } },
    });
    await outbox.schedule();
    await outbox.schedule();
    assert.equal(
      await db.telegramDelivery.count({ where: { userId: f.user.id, template: "digest" } }),
      1,
    );
    await outbox.deliverOne();
    assert.equal(fakeTransportCalls, 0);
    await db.telegramSettings.update({
      where: { userId: f.user.id },
      data: { quietHours: Prisma.DbNull },
    });
    await db.telegramDelivery.updateMany({
      where: { userId: f.user.id, state: "pending" },
      data: { availableAt: new Date() },
    });
    for (let i = 0; i < 10 && (await outbox.deliverOne()); i++) {}
    const sent = fakeTransportCalls;
    assert.ok(sent > 0);
    await outbox.deliverOne();
    assert.equal(fakeTransportCalls, sent);
    assert.equal(
      await db.telegramDelivery.count({ where: { userId: f.user.id, state: "pending" } }),
      0,
    );
    assert.equal(
      await db.telegramDelivery.count({ where: { userId: f.user.id, state: "unknown" } }),
      sent,
    );
    checks.push(
      "quiet-hour digest remains due once; unknown fake deliveries are never automatically resent",
    );
    await db.$transaction(async (tx) => {
      await lockWorkUser(tx, f.user.id);
      await enqueueTelegramNotice(tx, link, {
        eventKey: "before-unlink",
        template: "help",
        actions: [{ kind: "queue", targetId: crypto.randomUUID(), expectedRevision: 1 }],
      });
    });
    await service.unlink(f.user.id, link.id, "session_user");
    assert.equal(
      await db.telegramAction.count({ where: { linkId: link.id, state: "pending" } }),
      0,
    );
    assert.equal(
      await db.telegramDelivery.count({ where: { linkId: link.id, state: "pending" } }),
      0,
    );
    await db.$transaction(async (tx) => {
      await lockWorkUser(tx, f.user.id);
      await assert.rejects(
        assertHumanActor(tx, f.user.id, {
          kind: "telegram_user",
          linkId: link.id,
          generation: link.generation,
        }),
      );
    });
    const pair2 = await service.pair(f.user.id, crypto.randomUUID(), "session_user");
    await inbound.accept(message(`/start ${pair2.code}`));
    const newLink = await db.telegramLink.findFirstOrThrow({
      where: { userId: f.user.id, active: true },
    });
    assert.notEqual(newLink.id, link.id);
    assert.equal(newLink.generation, link.generation + 1);
    await assert.rejects(service.unlink(f.user.id, link.id, "session_user"));
    checks.push(
      "unlink revokes pending actions and deliveries; stale unlink cannot revoke a new pairing generation",
    );
    return { checks, fakeTransportCalls };
  } finally {
    for (const userId of owners) {
      const active = await db.telegramLink.findFirst({ where: { userId, active: true } });
      if (active) await service.unlink(userId, active.id, "session_user");
      await db.telegramUpdate.updateMany({
        where: { userId, state: { in: ["pending", "processing"] } },
        data: { state: "cancelled", completedAt: new Date() },
      });
      await db.telegramDelivery.updateMany({
        where: { userId, state: { in: ["pending", "sending"] } },
        data: { state: "cancelled", failureCode: "revoked" },
      });
    }
  }
}
