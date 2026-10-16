import { z } from "zod/v4";

export const TELEGRAM_UPDATE_STATES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export const TELEGRAM_ACTION_KINDS = [
  "answer",
  "apply_now",
  "queue",
  "skip",
  "approve",
  "decline",
  "exclude_company",
  "undo",
] as const;
export const TELEGRAM_ACTION_STATES = [
  "pending",
  "processing",
  "completed",
  "revoked",
  "expired",
] as const;
export const TELEGRAM_DELIVERY_STATES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "unknown",
  "cancelled",
] as const;
export const TELEGRAM_TEMPLATE_KINDS = [
  "help",
  "paired",
  "status",
  "intake",
  "question",
  "approval",
  "rule",
  "digest",
  "action_done",
  "web_required",
] as const;
export const TELEGRAM_DELIVERY_FAILURES = [
  "disabled",
  "rejected",
  "rate_limited",
  "transport_unknown",
  "dispatch_interrupted",
  "revoked",
  "invalid_template",
] as const;
export const TELEGRAM_SENDER_EVENT_KINDS = ["failed_code", "reply"] as const;

const quietHours = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .strict()
  .refine((value) => value.startMinute !== value.endMinute);
const timeZone = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a supported time zone.");
export const telegramSettingsSchema = z.object({
  revision: z.number().int().min(1),
  digestEnabled: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
  timeZone,
  quietHours: quietHours.nullable(),
});
export const telegramSettingsInputSchema = telegramSettingsSchema
  .omit({ revision: true })
  .extend({ requestId: z.uuid(), expectedRevision: z.number().int().min(1) })
  .strict();
export const telegramStatusSchema = z.object({
  configured: z.boolean(),
  deliveryEnabled: z.boolean(),
  /** Without @, for the manual instructions. Null when Telegram is not configured. */
  botUsername: z.string().nullable(),
  link: z.object({ id: z.uuid(), linkedAt: z.date(), username: z.string().nullable() }).nullable(),
  settings: telegramSettingsSchema,
  pairing: z.object({ id: z.uuid(), expiresAt: z.date() }).nullable(),
});
export const telegramPairingInputSchema = z.object({ requestId: z.uuid() }).strict();
export const telegramPairingSchema = z.object({
  pairingId: z.uuid(),
  /** Displayed as `K7P-4QX`; returned once and never stored in plain text. */
  code: z.string().regex(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/),
  expiresAt: z.date(),
  /** The t.me deep link the QR code encodes; Telegram sends `/start <code>` from it. */
  startUrl: z.url(),
});
export const telegramUnlinkInputSchema = z.object({ expectedLinkId: z.uuid() }).strict();
export const telegramUnlinkedSchema = z.object({ disconnected: z.literal(true) });
export const telegramOkSchema = z.object({ ok: z.literal(true) });
export type TelegramSettingsInput = z.infer<typeof telegramSettingsInputSchema>;
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;
export type TelegramPairing = z.infer<typeof telegramPairingSchema>;
export type TelegramActionKind = (typeof TELEGRAM_ACTION_KINDS)[number];
export type TelegramTemplateKind = (typeof TELEGRAM_TEMPLATE_KINDS)[number];

const telegramId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sender = z.object({
  id: telegramId,
  is_bot: z.boolean(),
  username: z.string().min(1).max(64).optional(),
});
const chat = z.object({ id: telegramId, type: z.string().max(32) });
const message = z.object({
  message_id: telegramId,
  from: sender.optional(),
  chat,
  text: z.string().max(4096).optional(),
  forward_origin: z.unknown().optional(),
  forward_from: z.unknown().optional(),
  via_bot: z.unknown().optional(),
});
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  message: message.optional(),
  callback_query: z
    .object({
      id: z.string().min(1).max(128),
      from: sender,
      message: message.optional(),
      data: z.string().min(1).max(64),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
