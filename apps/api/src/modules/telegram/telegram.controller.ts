import { idParam } from "@openapply/contracts/shared";
import {
  telegramOkSchema,
  telegramPairingInputSchema,
  telegramPairingSchema,
  telegramSettingsInputSchema,
  telegramSettingsSchema,
  telegramStatusSchema,
  telegramUnlinkedSchema,
  telegramUnlinkInputSchema,
} from "@openapply/contracts/telegram";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { TelegramService } from "./telegram.service";

const service = container.resolve(TelegramService);
export const telegramController = new Elysia({ prefix: "/telegram" })
  .use(authGuard)
  .get("/", ({ user }) => service.status(user.id), {
    response: telegramStatusSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "Read Telegram settings without contacting Telegram" },
  })
  .post("/pairing", ({ user, body, authKind }) => service.pair(user.id, body.requestId, authKind), {
    body: telegramPairingInputSchema,
    response: telegramPairingSchema,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: { summary: "Create a private one-use pairing code in signed-in Settings" },
  })
  .delete(
    "/pairing/:id",
    ({ user, params, authKind }) => service.cancelPair(user.id, params.id, authKind),
    {
      params: idParam,
      response: telegramOkSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: { summary: "Cancel an owned pending Telegram pairing" },
    },
  )
  .delete(
    "/",
    ({ user, body, authKind }) => service.unlink(user.id, body.expectedLinkId, authKind),
    {
      body: telegramUnlinkInputSchema,
      response: telegramUnlinkedSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: { summary: "Unlink the current Telegram generation and revoke pending actions" },
    },
  )
  .patch("/settings", ({ user, body, authKind }) => service.settings(user.id, body, authKind), {
    body: telegramSettingsInputSchema,
    response: telegramSettingsSchema,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: { summary: "Update revisioned Telegram notification preferences" },
  });
