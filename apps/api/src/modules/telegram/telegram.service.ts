import {
  type TelegramSettingsInput,
  telegramSettingsInputSchema,
  telegramSettingsSchema,
} from "@openapply/contracts/telegram";
import { inject, singleton } from "tsyringe";
import { sha256 } from "@/common/crypto/hash";
import { conflict, forbidden, notFound } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import {
  formatPairingCode,
  newPairingCode,
  pairingHash,
  telegramCanonical,
} from "./telegram.policy";

function webSession(kind: AuthKind) {
  if (kind !== "session_user") throw forbidden("Use signed-in Settings to manage Telegram.");
}
export async function revokeTelegramLink(
  tx: Prisma.TransactionClient,
  userId: string,
  linkId: string,
) {
  await tx.telegramLink.updateMany({
    where: { id: linkId, userId, active: true },
    data: { active: false, senderId: null, chatId: null },
  });
  await tx.telegramAction.updateMany({
    where: { linkId, userId, state: { in: ["pending", "processing"] } },
    data: { state: "revoked" },
  });
  await tx.telegramDelivery.updateMany({
    where: { linkId, userId, state: { in: ["pending", "failed"] } },
    data: { state: "cancelled", failureCode: "revoked" },
  });
  await tx.telegramUpdate.updateMany({
    where: { linkId, userId, state: { in: ["pending", "processing"] } },
    data: { state: "cancelled" },
  });
}
@singleton()
export class TelegramService {
  constructor(
    private readonly prisma: PrismaClient,
    @inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder,
  ) {}
  async status(userId: string) {
    const [link, settings, pairing] = await Promise.all([
      this.prisma.telegramLink.findFirst({ where: { userId, active: true } }),
      this.prisma.telegramSettings.findUnique({ where: { userId } }),
      this.prisma.telegramPairing.findFirst({
        where: { userId, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      configured: this.config.telegram !== null,
      deliveryEnabled: this.config.telegram?.deliveryEnabled === true,
      botUsername: this.config.telegram?.botUsername ?? null,
      link: link?.linkedAt
        ? { id: link.id, linkedAt: link.linkedAt, username: link.username }
        : null,
      settings: telegramSettingsSchema.parse(settings),
      pairing: pairing ? { id: pairing.id, expiresAt: pairing.expiresAt } : null,
    };
  }
  async pair(userId: string, requestId: string, kind: AuthKind) {
    webSession(kind);
    const telegram = this.config.telegram;
    if (!telegram) throw conflict("Telegram is not configured on this server.");
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      if (
        await tx.telegramPairing.findUnique({ where: { userId_requestId: { userId, requestId } } })
      )
        throw conflict(
          "Pairing was already created. Cancel the pending pairing and create a new code; raw codes cannot be recovered.",
        );
      const now = new Date();
      await tx.telegramPairing.updateMany({
        where: { userId, consumedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      // Hashes are unique, and a 6-character code space can collide; draw again on a clash.
      let code = newPairingCode();
      for (
        let tries = 1;
        await tx.telegramPairing.findUnique({
          where: { codeHash: pairingHash(code, telegram.pairingKey) },
        });
        tries++
      ) {
        if (tries >= 5) throw conflict("Could not create a pairing code. Try again.");
        code = newPairingCode();
      }
      const row = await tx.telegramPairing.create({
        data: {
          userId,
          requestId,
          codeHash: pairingHash(code, telegram.pairingKey),
          expiresAt: new Date(now.getTime() + 10 * 60_000),
        },
      });
      return {
        pairingId: row.id,
        code: formatPairingCode(code),
        expiresAt: row.expiresAt,
        startUrl: `https://t.me/${telegram.botUsername}?start=${code}`,
      };
    });
  }
  async cancelPair(userId: string, id: string, kind: AuthKind) {
    webSession(kind);
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const row = await tx.telegramPairing.findFirst({ where: { id, userId } });
      if (!row) throw notFound();
      await tx.telegramPairing.updateMany({
        where: { id, userId, consumedAt: null, cancelledAt: null },
        data: { cancelledAt: new Date() },
      });
    });
    return { ok: true as const };
  }
  async unlink(userId: string, expectedLinkId: string, kind: AuthKind) {
    webSession(kind);
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const active = await tx.telegramLink.findFirst({ where: { userId, active: true } });
      if (active && active.id !== expectedLinkId)
        throw conflict("Telegram was linked again. Refresh Settings before unlinking.");
      if (active) await revokeTelegramLink(tx, userId, active.id);
      await tx.telegramPairing.updateMany({
        where: { userId, consumedAt: null, cancelledAt: null },
        data: { cancelledAt: new Date() },
      });
    });
    return { disconnected: true as const };
  }
  async settings(userId: string, raw: TelegramSettingsInput, kind: AuthKind) {
    webSession(kind);
    const input = telegramSettingsInputSchema.parse(raw);
    const payloadHash = sha256(telegramCanonical(input));
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const prior = await tx.telegramSettingRequest.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("This settings request ID was already used for different values.");
        return telegramSettingsSchema.parse(prior.response);
      }
      const current = await tx.telegramSettings.findUnique({ where: { userId } });
      if (!current) throw conflict("Telegram settings are not initialized.");
      if (current.revision !== input.expectedRevision)
        throw conflict("Notification settings changed. Refresh before saving.");
      const data = {
        revision: input.expectedRevision + 1,
        digestEnabled: input.digestEnabled,
        digestHour: input.digestHour,
        timeZone: input.timeZone,
        quietHours: input.quietHours ?? Prisma.DbNull,
      };
      const row = await tx.telegramSettings.update({ where: { userId }, data });
      const response = telegramSettingsSchema.parse(row);
      await tx.telegramSettingRequest.create({
        data: { userId, requestId: input.requestId, payloadHash, response },
      });
      return response;
    });
  }
}
