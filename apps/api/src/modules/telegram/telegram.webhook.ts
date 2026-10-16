import { telegramOkSchema } from "@openapply/contracts/telegram";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import { TelegramInbound } from "./telegram.inbound";
import { readTelegramUpdate } from "./telegram.webhook-body";

const service = container.resolve(TelegramInbound),
  config = container.resolve<TelegramConfigHolder>(TELEGRAM_CONFIG);
export const telegramWebhookController = new Elysia({ prefix: "/telegram" }).post(
  "/webhook",
  async ({ request }) => {
    await service.accept(await readTelegramUpdate(request, config.telegram?.webhookSecret ?? null));
    return { ok: true as const };
  },
  {
    parse: "none",
    response: telegramOkSchema,
    beforeHandle: rateLimit(RATE_LIMITS.publicJobs),
    detail: {
      summary: "Accept a secret-verified private Telegram update with durable deduplication",
    },
  },
);
