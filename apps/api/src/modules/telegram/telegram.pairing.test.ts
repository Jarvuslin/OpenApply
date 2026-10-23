import "reflect-metadata";
import type { TelegramDomain } from "./telegram.domain";
import { telegramFake, telegramTestConfig } from "./telegram.fakes";
import { TelegramInbound } from "./telegram.inbound";
import { senderHash } from "./telegram.policy";
import { TelegramService } from "./telegram.service";
import type { TelegramTransport } from "./telegram.transport";
import { expect, test } from "bun:test";

let nextUpdate = 1000;
function message(text: string, from = 42, username?: string) {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextUpdate,
      from: { id: from, is_bot: false, ...(username ? { username } : {}) },
      chat: { id: from, type: "private" },
      text,
    },
  };
}
function setup() {
  const db = telegramFake();
  const sent: { chatId: string; text: string }[] = [];
  const transport = {
    send: async (outgoing: { chatId: string; text: string }) => {
      sent.push(outgoing);
      return { state: "sent" as const, messageId: String(sent.length) };
    },
  } as unknown as TelegramTransport;
  const service = new TelegramService(db.prisma, telegramTestConfig);
  const inbound = new TelegramInbound(
    db.prisma,
    {} as TelegramDomain,
    transport,
    telegramTestConfig,
  );
  const pair = (userId = db.userId) => service.pair(userId, crypto.randomUUID(), "session_user");
  const replies = () => db.tables.telegramUpdate!.filter((row) => row.intent.kind === "reply");
  const drain = async () => {
    while (await inbound.processOne()) {}
  };
  return { db, service, inbound, pair, replies, drain, sent };
}

test("the QR deep link links the account, stores the numeric ID and username, and confirms", async () => {
  const { db, service, inbound, pair } = setup();
  const code = await pair();
  expect(code.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  expect(code.startUrl).toBe(`https://t.me/synthetic_bot?start=${code.code.replace("-", "")}`);
  expect(JSON.stringify(db.tables)).not.toContain(code.code.replace("-", ""));

  await inbound.accept(message(`/start ${code.code.replace("-", "")}`, 42, "jordan"));
  const link = db.tables.telegramLink![0]!;
  expect(link).toMatchObject({ userId: db.userId, senderId: "42", chatId: "42", active: true });
  expect(link.username).toBe("jordan");
  expect(db.tables.telegramDelivery).toHaveLength(1);
  expect(db.tables.telegramDelivery![0]!.template).toBe("paired");
  const status = await service.status(db.userId);
  expect(status.link?.username).toBe("jordan");
  expect(status.pairing).toBeNull();
});

test("a typed code links in any case or spacing, and a link without a username shows none", async () => {
  const { db, inbound, pair } = setup();
  const code = await pair();
  await inbound.accept(message(code.code.toLowerCase().replace("-", " ")));
  expect(db.tables.telegramLink).toHaveLength(1);
  expect(db.tables.telegramLink![0]!.username).toBeNull();
});

test("a repeated Telegram update links once and replies once", async () => {
  const { db, inbound, pair, replies } = setup();
  const code = await pair();
  const update = message(code.code);
  await inbound.accept(update);
  await inbound.accept(update);
  expect(db.tables.telegramLink).toHaveLength(1);
  expect(db.tables.telegramDelivery).toHaveLength(1);
  const wrong = message("ZZZ-ZZZ", 77);
  await inbound.accept(wrong);
  await inbound.accept(wrong);
  expect(replies()).toHaveLength(1);
  expect(db.tables.telegramSenderEvent!.filter((row) => row.kind === "failed_code")).toHaveLength(
    1,
  );
});

test("wrong, expired and already-used codes are explained and never link", async () => {
  const { db, inbound, pair, replies, drain, sent } = setup();
  await inbound.accept(message("ZZZ-ZZZ"));
  const expired = await pair();
  db.tables.telegramPairing!.at(-1)!.expiresAt = new Date(Date.now() - 1000);
  await inbound.accept(message(expired.code));
  const used = await pair();
  await inbound.accept(message(used.code, 43));
  await inbound.accept(message(used.code, 44));
  expect(db.tables.telegramLink).toHaveLength(1);
  expect(db.tables.telegramLink![0]!.senderId).toBe("43");
  expect(replies().map((row) => row.intent.reply)).toEqual([
    "invalid_code",
    "expired_code",
    "expired_code",
  ]);
  await drain();
  expect(sent.map((row) => row.chatId)).toEqual(["42", "42", "44"]);
  expect(sent[0]!.text).toContain("didn't match");
  expect(sent[1]!.text).toContain("expired");
});

test("a new code replaces the old one, so only one code per account works", async () => {
  const { db, inbound, pair } = setup();
  const first = await pair();
  await pair();
  await inbound.accept(message(first.code));
  expect(db.tables.telegramLink).toHaveLength(0);
});

test("after five wrong codes a sender is refused even with a valid code", async () => {
  const { db, inbound, pair, replies } = setup();
  for (const wrong of ["AAA-AAA", "BBB-BBB", "CCC-CCC", "DDD-DDD", "EEE-EEE"])
    await inbound.accept(message(wrong));
  const valid = await pair();
  await inbound.accept(message(valid.code));
  expect(db.tables.telegramLink).toHaveLength(0);
  expect(replies().at(-1)!.intent.reply).toBe("too_many_tries");
  await inbound.accept(message(valid.code, 43));
  expect(db.tables.telegramLink).toHaveLength(1);
});

test("too many failures across all senders pause code checks for everyone", async () => {
  const { db, inbound, pair, replies } = setup();
  for (let index = 0; index < 300; index++)
    db.tables.telegramSenderEvent!.push({
      id: crypto.randomUUID(),
      senderHash: `other-${index}`,
      kind: "failed_code",
      createdAt: new Date(),
    });
  const valid = await pair();
  await inbound.accept(message(valid.code));
  expect(db.tables.telegramLink).toHaveLength(0);
  expect(replies().at(-1)!.intent.reply).toBe("busy");
});

test("one Telegram account cannot be linked to two OpenApply accounts", async () => {
  const { db, inbound, pair, replies } = setup();
  await inbound.accept(message((await pair()).code));
  const otherUser = crypto.randomUUID();
  await inbound.accept(message(`/start ${(await pair(otherUser)).code}`));
  expect(db.tables.telegramLink!.filter((row) => row.active)).toHaveLength(1);
  expect(db.tables.telegramLink![0]!.userId).toBe(db.userId);
  expect(replies().at(-1)!.intent.reply).toBe("linked_elsewhere");
});

test("relinking the same account replaces the link, and unlink frees the Telegram account", async () => {
  const { db, service, inbound, pair } = setup();
  await inbound.accept(message((await pair()).code));
  await inbound.accept(message(`/start ${(await pair()).code}`));
  expect(db.tables.telegramLink!.filter((row) => row.active)).toHaveLength(1);
  expect(db.tables.telegramLink!.at(-1)!.generation).toBe(2);
  await service.unlink(db.userId, db.tables.telegramLink!.at(-1)!.id, "session_user");
  expect(db.tables.telegramLink!.filter((row) => row.active)).toHaveLength(0);
  const otherUser = crypto.randomUUID();
  await inbound.accept(message((await pair(otherUser)).code));
  expect(db.tables.telegramLink!.find((row) => row.active)!.userId).toBe(otherUser);
});

test("an unlinked /start gets instructions; a linked chat's ordinary words stay commands", async () => {
  const { db, inbound, pair, replies, drain, sent } = setup();
  await inbound.accept(message("/start"));
  await inbound.accept(message("hello there"));
  expect(replies().map((row) => row.intent.reply)).toEqual(["welcome", "welcome"]);
  await drain();
  expect(sent[0]!.text).toContain("6-character code");

  await inbound.accept(message((await pair()).code));
  await inbound.accept(message("STATUS"));
  const last = db.tables.telegramUpdate!.at(-1)!;
  expect(last.linkId).toBe(db.tables.telegramLink![0]!.id);
  expect(last.intent).toEqual({ kind: "help" });
  expect(db.tables.telegramSenderEvent!.filter((row) => row.kind === "failed_code")).toHaveLength(
    0,
  );
});

test("replies to one sender are capped so the bot cannot be used to spam", async () => {
  const { inbound, replies, db } = setup();
  for (let index = 0; index < 12; index++) await inbound.accept(message("hi"));
  expect(replies()).toHaveLength(10);
  const hash = senderHash("42", telegramTestConfig.telegram!.pairingKey);
  expect(db.tables.telegramSenderEvent!.every((row) => row.senderHash === hash)).toBe(true);
});
