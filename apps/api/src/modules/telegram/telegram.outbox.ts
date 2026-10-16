import { pageSlice } from "@openapply/contracts/pagination";
import { telegramSettingsSchema } from "@openapply/contracts/telegram";
import { inject, singleton } from "tsyringe";
import { HttpError } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import { TelegramDomain } from "./telegram.domain";
import { liveLink } from "./telegram.inbound";
import { enqueueTelegramNotice, renderTelegramNotice } from "./telegram.notice";
import { digestBucket, quietNow } from "./telegram.policy";
import { TelegramTransport } from "./telegram.transport";

async function currentOrDeleted(read: () => Promise<boolean>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return false;
    throw error;
  }
}

@singleton()
export class TelegramOutbox {
  private accountPage = 1;
  private readonly noticePages = new Map<string, number>();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly domain: TelegramDomain,
    private readonly transport: TelegramTransport,
    @inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder,
  ) {}
  async schedule() {
    if (!this.config.telegram) return;
    const links = await this.prisma.telegramLink.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
      ...pageSlice({ page: this.accountPage, limit: 20 }),
    });
    this.accountPage = links.length === 20 ? this.accountPage + 1 : 1;
    for (const link of links) {
      const page = this.noticePages.get(link.id) ?? 1;
      const { notices, hasMore } = await this.domain.notices(link.userId, page);
      if (this.noticePages.size >= 1000) this.noticePages.clear();
      this.noticePages.set(link.id, hasMore ? page + 1 : 1);
      const settings = telegramSettingsSchema.parse(
        await this.prisma.telegramSettings.findUnique({ where: { userId: link.userId } }),
      );
      const bucket = settings.digestEnabled ? digestBucket(settings, new Date()) : null;
      if (bucket)
        notices.push({
          eventKey: `digest:${bucket}`,
          template: "digest",
          payload: await this.domain.status(link.userId),
        });
      await this.prisma.$transaction(async (tx) => {
        await lockWorkUser(tx, link.userId);
        const active = await liveLink(tx, link.id, link.userId, link.generation);
        if (!active) return;
        for (const notice of notices) await enqueueTelegramNotice(tx, active, notice);
      });
    }
  }
  async deliverOne() {
    const config = this.config.telegram;
    if (!config?.deliveryEnabled) return false;
    await this.prisma.telegramDelivery.updateMany({
      where: { state: "sending", sendingAt: { lt: new Date(Date.now() - 60_000) } },
      data: { state: "unknown", failureCode: "dispatch_interrupted" },
    });
    const row = await this.prisma.telegramDelivery.findFirst({
      where: { state: "pending", availableAt: { lte: new Date() }, attempts: { lt: 3 } },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!row) return false;
    const freshStatus = ["digest", "status"].includes(row.template)
      ? await this.domain.status(row.userId)
      : null;
    const prepared = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, row.userId);
      const link = await liveLink(tx, row.linkId, row.userId, row.generation);
      if (!link?.chatId) {
        await tx.telegramDelivery.updateMany({
          where: { id: row.id, state: "pending" },
          data: { state: "cancelled", failureCode: "revoked" },
        });
        return null;
      }
      const settings = telegramSettingsSchema.parse(
        await tx.telegramSettings.findUnique({ where: { userId: row.userId } }),
      );
      if (row.template === "digest" && !settings.digestEnabled) {
        await tx.telegramDelivery.updateMany({
          where: { id: row.id, state: "pending" },
          data: { state: "cancelled", failureCode: "revoked" },
        });
        return null;
      }
      if (quietNow(settings, new Date())) {
        await tx.telegramDelivery.updateMany({
          where: { id: row.id, state: "pending" },
          data: { availableAt: new Date(Date.now() + 60_000) },
        });
        return null;
      }
      if (!(await currentOrDeleted(() => this.domain.noticeCurrent(row)))) {
        await tx.telegramDelivery.updateMany({
          where: { id: row.id, state: "pending" },
          data: { state: "cancelled", failureCode: "revoked" },
        });
        return null;
      }
      const payload: Record<string, unknown> = {
        ...(row.payload as Record<string, unknown>),
        ...freshStatus,
      };
      const actionIds = Array.isArray(payload.actions)
        ? payload.actions.filter((id): id is string => typeof id === "string").slice(0, 6)
        : [];
      const actions = await tx.telegramAction.findMany({
        where: {
          id: { in: actionIds },
          userId: row.userId,
          linkId: row.linkId,
          generation: row.generation,
        },
      });
      if (row.attempts < 3)
        for (const action of actions) {
          if (
            action.state === "pending" &&
            action.expiresAt <= new Date() &&
            (await currentOrDeleted(() => this.domain.current(action)))
          ) {
            action.expiresAt = new Date(Date.now() + 30 * 60_000);
            await tx.telegramAction.updateMany({
              where: { id: action.id, state: "pending" },
              data: { expiresAt: action.expiresAt },
            });
          }
        }
      const claimed = await tx.telegramDelivery.updateMany({
        where: { id: row.id, state: "pending", attempts: row.attempts },
        data: {
          state: "sending",
          sendingAt: new Date(),
          attempts: { increment: 1 },
          payload: toInputJson(payload),
        },
      });
      if (!claimed.count) return null;
      return renderTelegramNotice(
        row.template,
        payload,
        actions,
        link.chatId,
        config.webUrl,
        config.webhookSecret,
      );
    });
    if (!prepared) return true;
    if (!(await liveLink(this.prisma, row.linkId, row.userId, row.generation))) {
      await this.prisma.telegramDelivery.updateMany({
        where: { id: row.id, state: "sending" },
        data: { state: "cancelled", failureCode: "revoked" },
      });
      return true;
    }
    const result = await this.transport.send(prepared);
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, row.userId);
      const active = await liveLink(tx, row.linkId, row.userId, row.generation);
      const retry =
        result.state === "failed" &&
        result.code === "rate_limited" &&
        row.attempts + 1 < 3 &&
        !!active;
      let data: Prisma.TelegramDeliveryUpdateManyMutationInput;
      if (result.state === "sent")
        data = {
          state: "sent" as const,
          messageId: result.messageId,
          sentAt: new Date(),
          failureCode: null,
        };
      else if (retry)
        data = {
          state: "pending" as const,
          failureCode: result.code,
          availableAt: new Date(Date.now() + (result.retryAfterSeconds ?? 60) * 1000),
        };
      else data = { state: result.state, failureCode: result.code };
      await tx.telegramDelivery.updateMany({ where: { id: row.id, state: "sending" }, data });
    });
    return true;
  }
}
