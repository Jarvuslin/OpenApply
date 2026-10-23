import type { Prisma, TelegramLink } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import type { TelegramConfigHolder } from "./telegram.config";
import { enqueueTelegramNotice } from "./telegram.notice";
import { pairingHash, senderHash, type telegramSender } from "./telegram.policy";
import { revokeTelegramLink } from "./telegram.service";

type Sender = NonNullable<ReturnType<typeof telegramSender>>;
type Config = NonNullable<TelegramConfigHolder["telegram"]>;

const PAIRING_REPLIES = [
  "welcome",
  "invalid_code",
  "expired_code",
  "too_many_tries",
  "busy",
  "linked_elsewhere",
] as const;
type PairingReply = (typeof PAIRING_REPLIES)[number];

const HOUR = 60 * 60_000;
const SENDER_FAILURES_PER_HOUR = 5;
const SENDER_REPLIES_PER_HOUR = 10;
// Across all senders: bounds guessing by many accounts at once (6 codes in ~887M per minute).
const GLOBAL_FAILURES_PER_10_MINUTES = 300;

export function pairingReplyText(reply: string, botUsername: string) {
  const fresh = "Get a new code in OpenApply under Settings → Telegram.";
  switch (reply as PairingReply) {
    case "welcome":
      return `Hi! To connect OpenApply, send me the 6-character code from Settings → Telegram, for example K7P-4QX. Or scan the QR code there and tap Start.`;
    case "invalid_code":
      return `That code didn't match. Check it and send it again. ${fresh}`;
    case "expired_code":
      return `That code has expired or was already used. Codes last 10 minutes. ${fresh}`;
    case "too_many_tries":
      return "Too many codes that didn't match. Wait an hour, then try again with a new code.";
    case "busy":
      return "OpenApply can't check codes right now. Try again in a few minutes.";
    case "linked_elsewhere":
      return `This Telegram account is already connected to another OpenApply account. Send /unlink here first, then use the new code with @${botUsername}.`;
    default:
      return fresh;
  }
}

async function count(
  tx: Prisma.TransactionClient,
  where: Prisma.TelegramSenderEventWhereInput,
  since: number,
) {
  return tx.telegramSenderEvent.count({ where: { ...where, createdAt: { gt: new Date(since) } } });
}

/**
 * Handles every message that is about linking: anything from an unlinked chat, and codes from a
 * linked one. Returns false when a linked chat sent ordinary text the command handler owns.
 * Runs inside the inbound transaction, after the update was deduplicated.
 */
export async function acceptPairing(
  tx: Prisma.TransactionClient,
  config: Config,
  sender: Sender,
  link: TelegramLink | null,
  updateId: string,
  callbackHash: string | null,
): Promise<boolean> {
  const { intent } = sender;
  const now = Date.now();
  const hash = senderHash(sender.senderId, config.pairingKey);
  const pairingFor = (code: string) =>
    tx.telegramPairing.findUnique({ where: { codeHash: pairingHash(code, config.pairingKey) } });
  const live = (row: Awaited<ReturnType<typeof pairingFor>>) =>
    !!row && !row.consumedAt && !row.cancelledAt && row.expiresAt.getTime() > now;

  if (link) {
    if (intent.kind !== "pair") return false;
    // A linked chat typing a code-shaped word is ordinary text unless it is a live code.
    if (!intent.explicit && !live(await pairingFor(intent.code))) return false;
  }

  async function record(reply: PairingReply | null) {
    let send = reply;
    if (send) {
      const replies = await count(tx, { senderHash: hash, kind: "reply" }, now - HOUR);
      if (replies >= SENDER_REPLIES_PER_HOUR) send = null;
      else await tx.telegramSenderEvent.create({ data: { senderHash: hash, kind: "reply" } });
    }
    await tx.telegramUpdate.create({
      data: {
        updateId,
        callbackHash,
        requestId: crypto.randomUUID(),
        intent: send ? { kind: "reply", chatId: sender.chatId, reply: send } : { kind: "ignored" },
        ...(send ? {} : { state: "completed", completedAt: new Date() }),
      },
    });
    return true;
  }
  async function fail(reply: PairingReply) {
    await tx.telegramSenderEvent.create({ data: { senderHash: hash, kind: "failed_code" } });
    return record(reply);
  }

  if (intent.kind !== "pair" && intent.kind !== "bad_code")
    return record(sender.callbackId ? null : "welcome");
  if (
    (await count(tx, { kind: "failed_code" }, now - 10 * 60_000)) >= GLOBAL_FAILURES_PER_10_MINUTES
  )
    return record("busy");
  if (
    (await count(tx, { senderHash: hash, kind: "failed_code" }, now - HOUR)) >=
    SENDER_FAILURES_PER_HOUR
  )
    return record("too_many_tries");
  if (intent.kind !== "pair") return fail("invalid_code");

  const pair = await pairingFor(intent.code);
  if (!pair) return fail("invalid_code");
  if (!live(pair)) return fail("expired_code");
  // Ownership is the numeric Telegram user ID, never the username.
  const owner = await tx.telegramLink.findFirst({
    where: { active: true, senderId: sender.senderId },
  });
  if (owner && owner.userId !== pair.userId) return record("linked_elsewhere");

  await lockWorkUser(tx, pair.userId);
  const consumed = await tx.telegramPairing.updateMany({
    where: { id: pair.id, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (!consumed.count) return fail("expired_code");
  const previous = await tx.telegramLink.findFirst({
    where: { userId: pair.userId },
    orderBy: { generation: "desc" },
  });
  if (previous?.active) await revokeTelegramLink(tx, pair.userId, previous.id);
  // The same Telegram account re-linking frees its unique sender/chat IDs first.
  if (owner && owner.id !== previous?.id) await revokeTelegramLink(tx, owner.userId, owner.id);
  const created = await tx.telegramLink.create({
    data: {
      userId: pair.userId,
      generation: (previous?.generation ?? 0) + 1,
      active: true,
      senderId: sender.senderId,
      chatId: sender.chatId,
      username: sender.username,
      linkedAt: new Date(),
    },
  });
  await tx.telegramUpdate.create({
    data: {
      updateId,
      callbackHash,
      userId: created.userId,
      linkId: created.id,
      generation: created.generation,
      requestId: crypto.randomUUID(),
      intent: { kind: "pair" },
      state: "completed",
      completedAt: new Date(),
    },
  });
  await enqueueTelegramNotice(tx, created, {
    eventKey: `paired:${created.id}`,
    template: "paired",
  });
  return true;
}
