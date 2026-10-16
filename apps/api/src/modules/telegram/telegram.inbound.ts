import type { TelegramUpdate } from "@openapply/contracts/telegram";
import { inject, singleton } from "tsyringe";
import { sha256 } from "@/common/crypto/hash";
import { conflict, HttpError } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { Prisma, PrismaClient, type TelegramLink } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import { TelegramDomain } from "./telegram.domain";
import { enqueueTelegramNotice, type TelegramNotice } from "./telegram.notice";
import { acceptPairing, pairingReplyText } from "./telegram.pairing";
import { actionId, actionToken, equalSecret, telegramSender } from "./telegram.policy";
import { revokeTelegramLink } from "./telegram.service";
import { TelegramTransport } from "./telegram.transport";

@singleton()
export class TelegramInbound {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly domain: TelegramDomain,
    private readonly transport: TelegramTransport,
    @inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder,
  ) {}
  async accept(update: TelegramUpdate) {
    const sender = telegramSender(update);
    if (!sender || !this.config.telegram) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('openapply:telegram:inbound'))`;
      const callbackHash = sender.callbackId ? sha256(sender.callbackId) : null;
      if (
        await tx.telegramUpdate.findFirst({
          where: {
            OR: [
              { updateId: String(update.update_id) },
              ...(callbackHash ? [{ callbackHash }] : []),
            ],
          },
        })
      )
        return;
      let link = await tx.telegramLink.findFirst({
        where: { active: true, senderId: sender.senderId, chatId: sender.chatId },
      });
      if (
        await acceptPairing(
          tx,
          this.config.telegram!,
          sender,
          link,
          String(update.update_id),
          callbackHash,
        )
      )
        return;
      if (!link) return;
      await lockWorkUser(tx, link.userId);
      link = await liveLink(tx, link.id, link.userId, link.generation);
      if (!link) return;
      let intent: unknown = ["pair", "bad_code", "start"].includes(sender.intent.kind)
        ? { kind: "help" }
        : sender.intent;
      if (sender.intent.kind === "action") {
        const id = actionId(sender.intent.token);
        if (!id) return;
        const action = await tx.telegramAction.findFirst({
          where: { id, userId: link.userId, linkId: link.id, generation: link.generation },
        });
        if (
          !action ||
          !equalSecret(
            sender.intent.token,
            actionToken(action, this.config.telegram!.webhookSecret),
          ) ||
          action.expiresAt <= new Date() ||
          ["expired", "revoked"].includes(action.state)
        )
          return;
        const expected = sender.intent.expectedKind;
        if (
          expected &&
          expected !== action.kind &&
          !(expected === "skip" && action.kind === "decline")
        )
          return;
        intent = { kind: "action", actionId: action.id };
      }
      await tx.telegramUpdate.create({
        data: {
          updateId: String(update.update_id),
          callbackHash,
          userId: link.userId,
          linkId: link.id,
          generation: link.generation,
          requestId: crypto.randomUUID(),
          intent: toInputJson(intent),
        },
      });
    });
  }
  async processOne() {
    const stale = new Date(Date.now() - 60_000);
    const candidate = await this.prisma.telegramUpdate.findFirst({
      where: { OR: [{ state: "pending" }, { state: "processing", processingAt: { lt: stale } }] },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    if (candidate.attempts >= 3) {
      const link =
        candidate.userId && candidate.linkId && candidate.generation
          ? await liveLink(this.prisma, candidate.linkId, candidate.userId, candidate.generation)
          : null;
      if (link)
        await this.finish(
          candidate.id,
          link,
          { eventKey: `update:${candidate.id}:review`, template: "web_required" },
          "failed",
        );
      else
        await this.prisma.telegramUpdate.updateMany({
          where: { id: candidate.id, state: candidate.state, processingAt: candidate.processingAt },
          data: { state: "failed", completedAt: new Date() },
        });
      return true;
    }
    const claimed = await this.prisma.telegramUpdate.updateMany({
      where: { id: candidate.id, state: candidate.state, processingAt: candidate.processingAt },
      data: { state: "processing", processingAt: new Date(), attempts: { increment: 1 } },
    });
    if (!claimed.count) return true;
    const reply = candidate.intent as { kind: string; chatId?: string; reply?: string };
    if (reply.kind === "reply") {
      await this.sendReply(candidate.id, reply.chatId!, reply.reply!);
      return true;
    }
    const { userId, linkId, generation } = candidate;
    if (!userId || !linkId || !generation) return true;
    let notice: TelegramNotice | null = null;
    try {
      const link = await liveLink(this.prisma, linkId, userId, generation);
      if (!link) throw conflict("Telegram link is no longer active.");
      const intent = candidate.intent as {
        kind: string;
        url?: string;
        company?: string;
        actionId?: string;
      };
      const actor = { kind: "telegram_user" as const, linkId, generation };
      if (intent.kind === "unlink") {
        await this.prisma.$transaction(async (tx) => {
          await lockWorkUser(tx, userId);
          await revokeTelegramLink(tx, userId, linkId);
        });
        return true;
      }
      if (intent.kind === "add")
        notice = await this.domain.add(userId, intent.url!, candidate.requestId, actor);
      else if (intent.kind === "status")
        notice = {
          eventKey: `update:${candidate.id}`,
          template: "status",
          payload: await this.domain.status(userId),
        };
      else if (intent.kind === "action" || intent.kind === "exclude") {
        let id = intent.actionId;
        if (intent.kind === "exclude") {
          const key = `update:${candidate.id}:exclude`;
          const prior = await this.prisma.telegramAction.findUnique({
            where: { linkId_generation_eventKey: { linkId, generation, eventKey: key } },
          });
          if (prior) id = prior.id;
          else {
            const spec = await this.domain.exclusion(userId, intent.company!);
            if (!spec) throw conflict("Use authenticated web review.");
            id = (
              await this.prisma.$transaction(async (tx) => {
                await lockWorkUser(tx, userId);
                if (!(await liveLink(tx, linkId, userId, generation)))
                  throw conflict("Telegram link is no longer active.");
                return tx.telegramAction.upsert({
                  where: { linkId_generation_eventKey: { linkId, generation, eventKey: key } },
                  update: {},
                  create: {
                    userId,
                    linkId,
                    generation,
                    eventKey: key,
                    kind: spec.kind,
                    targetId: spec.targetId,
                    expectedRevision: spec.expectedRevision,
                    payload: toInputJson(spec.payload ?? {}),
                    requestId: candidate.requestId,
                    expiresAt: new Date(Date.now() + 30 * 60_000),
                  },
                });
              })
            ).id;
          }
        }
        const action = await this.prisma.$transaction(async (tx) => {
          await lockWorkUser(tx, userId);
          if (!(await liveLink(tx, linkId, userId, generation)))
            throw conflict("Telegram link is no longer active.");
          const row = await tx.telegramAction.findFirst({
            where: { id, userId, linkId, generation },
          });
          if (!row || ["revoked", "expired"].includes(row.state) || row.expiresAt <= new Date())
            throw conflict("Telegram action expired.");
          if (row.state !== "completed")
            await tx.telegramAction.update({
              where: { id: row.id },
              data: { state: "processing" },
            });
          return row;
        });
        notice = action.state === "completed" ? null : await this.domain.execute(action);
        await this.prisma.$transaction(async (tx) => {
          await lockWorkUser(tx, userId);
          if (!(await liveLink(tx, linkId, userId, generation))) return;
          await tx.telegramAction.updateMany({
            where: { id: action.id, state: "processing" },
            data: { state: "completed", completedAt: new Date() },
          });
          if (notice) await enqueueTelegramNotice(tx, link, notice);
        });
        notice = null;
      } else notice = { eventKey: `update:${candidate.id}`, template: "help" };
      await this.finish(candidate.id, link, notice, "completed");
    } catch (error) {
      if (!(error instanceof HttpError)) return true;
      const link = await liveLink(this.prisma, linkId, userId, generation);
      if (link)
        await this.finish(
          candidate.id,
          link,
          { eventKey: `update:${candidate.id}:review`, template: "web_required" },
          "failed",
        );
      else
        await this.prisma.telegramUpdate.updateMany({
          where: { id: candidate.id, state: "processing" },
          data: { state: "cancelled", completedAt: new Date() },
        });
    }
    return true;
  }
  /** Replies to a chat that is not linked yet, so there is no link outbox to deliver through. */
  private async sendReply(id: string, chatId: string, reply: string) {
    const result = await this.transport.send({
      chatId,
      text: pairingReplyText(reply, this.config.telegram!.botUsername),
      silent: false,
    });
    const retry = result.state === "failed" && result.code === "rate_limited";
    let state: "completed" | "failed" | "pending" = "failed";
    if (result.state === "sent") state = "completed";
    if (retry) state = "pending";
    await this.prisma.telegramUpdate.updateMany({
      where: { id, state: "processing" },
      data: { state, completedAt: retry ? null : new Date() },
    });
  }
  private async finish(
    id: string,
    link: TelegramLink,
    notice: TelegramNotice | null,
    state: "completed" | "failed",
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, link.userId);
      if (!(await liveLink(tx, link.id, link.userId, link.generation))) return;
      if (notice) await enqueueTelegramNotice(tx, link, notice);
      await tx.telegramUpdate.updateMany({
        where: { id, state: "processing" },
        data: { state, completedAt: new Date() },
      });
    });
  }
}
export function liveLink(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  generation: number,
) {
  return tx.telegramLink.findFirst({ where: { id, userId, generation, active: true } });
}
