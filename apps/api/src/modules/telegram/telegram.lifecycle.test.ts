import "reflect-metadata";
import { notFound } from "@/common/errors";
import type { TelegramDomain } from "./telegram.domain";
import { telegramFake, telegramTestConfig } from "./telegram.fakes";
import { TelegramInbound } from "./telegram.inbound";
import { TelegramOutbox } from "./telegram.outbox";
import { actionToken } from "./telegram.policy";
import { TelegramService } from "./telegram.service";
import type { TelegramTransport } from "./telegram.transport";
import { expect, test } from "bun:test";

const privateUpdate = (id: number, text: string) => ({
  update_id: id,
  message: {
    message_id: id + 1,
    from: { id: 42, is_bot: false },
    chat: { id: 42, type: "private" },
    text,
  },
});
function replyTransport() {
  const sent: { chatId: string; text: string }[] = [];
  const transport = {
    send: async (message: { chatId: string; text: string }) => {
      sent.push(message);
      return { state: "sent" as const, messageId: String(sent.length) };
    },
  } as unknown as TelegramTransport;
  return { transport, sent };
}
function domainFake() {
  const calls: { kind: string; id: string }[] = [];
  const domain = {
    status: async () => ({
      queued: 1,
      running: 0,
      needsYou: 1,
      presence: "unknown",
      executionAvailable: false,
    }),
    add: async (_user: string, _url: string, requestId: string) => {
      calls.push({ kind: "add", id: requestId });
      return { eventKey: `add:${requestId}`, template: "intake", payload: {} };
    },
    execute: async (action: { id: string; requestId: string }) => {
      calls.push({ kind: "action", id: action.requestId });
      return { eventKey: `action:${action.id}`, template: "action_done" };
    },
    notices: async () => ({ notices: [], hasMore: false }),
    noticeCurrent: async () => true,
  };
  return { domain: domain as unknown as TelegramDomain, calls };
}

test("private one-use pairing persists only hash, creates fresh link identity and deduplicates noncontiguous updates", async () => {
  const db = telegramFake(),
    service = new TelegramService(db.prisma, telegramTestConfig),
    { domain } = domainFake(),
    inbound = new TelegramInbound(
      db.prisma,
      domain,
      replyTransport().transport,
      telegramTestConfig,
    );
  const requestId = crypto.randomUUID(),
    first = await service.pair(db.userId, requestId, "session_user");
  expect(JSON.stringify(db.tables)).not.toContain(first.code);
  await expect(service.pair(db.userId, requestId, "session_user")).rejects.toThrow(
    "already created",
  );
  await expect(service.pair(db.userId, crypto.randomUUID(), "agent")).rejects.toThrow();
  await inbound.accept(privateUpdate(900, `/start ${first.code}`));
  await inbound.accept(privateUpdate(900, `/start ${first.code}`));
  const old = db.tables.telegramLink![0]!;
  expect(old.active).toBe(true);
  expect(db.tables.telegramDelivery).toHaveLength(1);
  const second = await service.pair(db.userId, crypto.randomUUID(), "session_user");
  await inbound.accept(privateUpdate(10, `/start ${second.code}`));
  expect(db.tables.telegramLink).toHaveLength(2);
  const active = db.tables.telegramLink![1]!;
  expect(active.id).not.toBe(old.id);
  expect(active.generation).toBe(2);
  expect(old.active).toBe(false);
  await expect(service.unlink(db.userId, old.id, "session_user")).rejects.toThrow("linked again");
  await service.unlink(db.userId, active.id, "session_user");
  await service.unlink(db.userId, active.id, "session_user");
  expect(active.active).toBe(false);
});

test("settings exact retry returns committed revision but request reuse and stale writes fail", async () => {
  const db = telegramFake(),
    service = new TelegramService(db.prisma, telegramTestConfig),
    input = {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      digestEnabled: true,
      digestHour: 17,
      timeZone: "UTC",
      quietHours: null,
    };
  const first = await service.settings(db.userId, input, "session_user"),
    retry = await service.settings(db.userId, input, "session_user");
  expect(first).toEqual(retry);
  expect(first.revision).toBe(2);
  expect(db.tables.telegramSettingRequest).toHaveLength(1);
  await expect(
    service.settings(db.userId, { ...input, digestHour: 18 }, "session_user"),
  ).rejects.toThrow("different values");
  await expect(
    service.settings(db.userId, { ...input, requestId: crypto.randomUUID() }, "session_user"),
  ).rejects.toThrow("changed");
});

test("links only prepare through exact request identity and arbitrary mixed text never invokes a domain mutation", async () => {
  const db = telegramFake();
  db.link();
  const { domain, calls } = domainFake(),
    inbound = new TelegramInbound(
      db.prisma,
      domain,
      replyTransport().transport,
      telegramTestConfig,
    );
  await inbound.accept(privateUpdate(10, "https://example.com/job"));
  await inbound.accept(privateUpdate(10, "https://example.com/job"));
  await inbound.accept(privateUpdate(11, "apply https://example.com/job"));
  await inbound.processOne();
  await inbound.processOne();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.kind).toBe("add");
  expect(calls[0]!.id).toBe(db.tables.telegramUpdate![0]!.requestId);
  expect(db.tables.telegramUpdate!.every((row) => row.state === "completed")).toBe(true);
});

test("callback replay is durable and unlink revokes outstanding actions before dispatch", async () => {
  const db = telegramFake(),
    link = db.link(),
    { domain, calls } = domainFake(),
    inbound = new TelegramInbound(
      db.prisma,
      domain,
      replyTransport().transport,
      telegramTestConfig,
    );
  const action = await db.prisma.telegramAction.create({
    data: {
      userId: db.userId,
      linkId: link.id,
      generation: 1,
      eventKey: "a",
      kind: "queue",
      targetId: crypto.randomUUID(),
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      payload: {},
      expiresAt: new Date(Date.now() + 100000),
    },
  });
  const token = actionToken(action, telegramTestConfig.telegram!.webhookSecret),
    message = privateUpdate(1, "/status").message;
  const callback = (id: number) => ({
    update_id: id,
    callback_query: { id: "same-callback", from: { id: 42, is_bot: false }, message, data: token },
  });
  await inbound.accept(callback(15));
  await inbound.accept(callback(18));
  expect(db.tables.telegramUpdate).toHaveLength(1);
  expect(JSON.stringify(db.tables.telegramUpdate)).not.toContain(token);
  await inbound.processOne();
  await inbound.accept({
    ...callback(20),
    callback_query: { ...callback(20).callback_query, id: "new-callback" },
  });
  await inbound.processOne();
  expect(calls).toHaveLength(1);
  const other = await db.prisma.telegramAction.create({
    data: {
      ...action,
      payload: {},
      id: crypto.randomUUID(),
      eventKey: "b",
      requestId: crypto.randomUUID(),
      state: "pending",
    },
  });
  await inbound.accept({
    ...callback(21),
    callback_query: {
      ...callback(21).callback_query,
      id: "third-callback",
      data: actionToken(other, telegramTestConfig.telegram!.webhookSecret),
    },
  });
  await new TelegramService(db.prisma, telegramTestConfig).unlink(
    db.userId,
    link.id,
    "session_user",
  );
  await inbound.processOne();
  expect(calls).toHaveLength(1);
});

async function outboxFixture() {
  const db = telegramFake(),
    link = db.link(),
    { domain } = domainFake();
  const row = await db.prisma.telegramDelivery.create({
    data: {
      userId: db.userId,
      linkId: link.id,
      generation: 1,
      eventKey: "test",
      template: "help",
      payload: {},
    },
  });
  return { ...db, link, row, domain };
}
test("delivery commits sending before dispatch and never replays an unknown send", async () => {
  const db = await outboxFixture();
  let calls = 0;
  const transport = {
    send: async () => {
      calls++;
      expect(db.tables.telegramDelivery![0]!.state).toBe("sending");
      return { state: "unknown", code: "transport_unknown" };
    },
  } as unknown as TelegramTransport;
  const outbox = new TelegramOutbox(db.prisma, db.domain, transport, {
    telegram: { ...telegramTestConfig.telegram!, deliveryEnabled: true },
  });
  await outbox.deliverOne();
  await outbox.deliverOne();
  expect(calls).toBe(1);
  expect(db.tables.telegramDelivery![0]!.state).toBe("unknown");
});
test("crashed sending remains unknown; explicit rate limit is bounded to three known-nondelivery attempts", async () => {
  const db = await outboxFixture();
  let calls = 0;
  const transport = {
    send: async () => {
      calls++;
      return { state: "failed", code: "rate_limited", retryAfterSeconds: 1 };
    },
  } as unknown as TelegramTransport;
  const outbox = new TelegramOutbox(db.prisma, db.domain, transport, {
    telegram: { ...telegramTestConfig.telegram!, deliveryEnabled: true },
  });
  for (let i = 0; i < 4; i++) {
    db.tables.telegramDelivery![0]!.availableAt = new Date(0);
    await outbox.deliverOne();
  }
  expect(calls).toBe(3);
  expect(db.tables.telegramDelivery![0]!.state).toBe("failed");
  const row = db.tables.telegramDelivery![0]!;
  row.state = "sending";
  row.sendingAt = new Date(0);
  await outbox.deliverOne();
  expect(row.state).toBe("unknown");
  expect(calls).toBe(3);
});

test("unknown processing failure retries only the same persisted domain request within the finite bound", async () => {
  const db = telegramFake();
  db.link();
  const ids: string[] = [],
    effects = new Set<string>();
  let fail = true;
  const domain = {
    add: async (_u: string, _url: string, requestId: string) => {
      ids.push(requestId);
      effects.add(requestId);
      if (fail) {
        fail = false;
        throw Error("simulated acknowledgement lost after commit");
      }
      return { eventKey: `add:${requestId}`, template: "intake" };
    },
  } as unknown as TelegramDomain;
  const inbound = new TelegramInbound(
    db.prisma,
    domain,
    replyTransport().transport,
    telegramTestConfig,
  );
  await inbound.accept(privateUpdate(100, "https://example.com/job"));
  await inbound.processOne();
  expect(db.tables.telegramUpdate![0]!.state).toBe("processing");
  db.tables.telegramUpdate![0]!.processingAt = new Date(0);
  await inbound.processOne();
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  expect(effects.size).toBe(1);
  expect(db.tables.telegramUpdate![0]!.state).toBe("completed");
});

test("quiet-hour deliveries wait and expired ordinary buttons refresh only before first delivery", async () => {
  const db = await outboxFixture(),
    now = new Date();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  db.tables.telegramSettings![0]!.quietHours = {
    startMinute: minute,
    endMinute: (minute + 1) % 1440,
  };
  const action = await db.prisma.telegramAction.create({
    data: {
      userId: db.userId,
      linkId: db.link.id,
      generation: 1,
      eventKey: "button",
      kind: "queue",
      targetId: crypto.randomUUID(),
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      payload: {},
      expiresAt: new Date(0),
    },
  });
  db.tables.telegramDelivery![0]!.payload = { actions: [action.id] };
  let sends = 0,
    refreshes = 0;
  const domain = {
    ...db.domain,
    current: async () => {
      refreshes++;
      return true;
    },
  } as unknown as TelegramDomain;
  const transport = {
    send: async (message: { buttons: unknown[] }) => {
      sends++;
      expect(message.buttons).toHaveLength(2);
      return { state: "sent", messageId: "90" };
    },
  } as unknown as TelegramTransport;
  const outbox = new TelegramOutbox(db.prisma, domain, transport, {
    telegram: { ...telegramTestConfig.telegram!, deliveryEnabled: true },
  });
  await outbox.deliverOne();
  expect(sends).toBe(0);
  expect(db.tables.telegramDelivery![0]!.state).toBe("pending");
  expect(refreshes).toBe(0);
  db.tables.telegramSettings![0]!.quietHours = null;
  db.tables.telegramDelivery![0]!.availableAt = new Date(0);
  await outbox.deliverOne();
  expect(sends).toBe(1);
  expect(refreshes).toBe(1);
});

test("a deleted or resolved pending target is cancelled so later deliveries are not starved", async () => {
  const db = await outboxFixture();
  let reads = 0,
    sends = 0;
  const domain = {
    ...db.domain,
    noticeCurrent: async () => {
      reads++;
      if (reads === 1) throw notFound();
      return true;
    },
  } as unknown as TelegramDomain;
  await db.prisma.telegramDelivery.create({
    data: {
      userId: db.userId,
      linkId: db.link.id,
      generation: 1,
      eventKey: "later",
      template: "help",
      payload: {},
    },
  });
  const transport = {
    send: async () => {
      sends++;
      return { state: "sent", messageId: "91" };
    },
  } as unknown as TelegramTransport;
  const outbox = new TelegramOutbox(db.prisma, domain, transport, {
    telegram: { ...telegramTestConfig.telegram!, deliveryEnabled: true },
  });
  await outbox.deliverOne();
  await outbox.deliverOne();
  expect(db.tables.telegramDelivery![0]!.state).toBe("cancelled");
  expect(sends).toBe(1);
});
