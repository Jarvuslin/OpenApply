import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import type {
  TelegramActionKind,
  TelegramSettings,
  TelegramUpdate,
} from "@openapply/contracts/telegram";

type TelegramIntent =
  /** `explicit` is a /start deep link; a bare code-shaped word may just be ordinary text. */
  | { kind: "pair"; code: string; explicit: boolean }
  | { kind: "start" | "bad_code" | "help" | "status" | "unlink" }
  | { kind: "add"; url: string }
  | { kind: "action"; token: string; expectedKind: TelegramActionKind | null }
  | { kind: "exclude"; company: string };
export function telegramCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(telegramCanonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([key, item]) => `${JSON.stringify(key)}:${telegramCanonical(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Expected JSON data.");
  return encoded;
}
export function equalSecret(value: string | undefined, expected: string) {
  if (typeof value !== "string" || value.length > 512) return false;
  const actual = Buffer.from(value),
    wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
// No 0/O or 1/I/L: people read these off a screen and type them on a phone.
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_LENGTH = 6;
export function newPairingCode() {
  let code = "";
  for (let index = 0; index < PAIRING_LENGTH; index++)
    code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}
/** Accepts any case, spaces and hyphens: `k7p-4qx`, `K7P 4QX`, `K7P4QX`. */
export function normalizePairingCode(text: string): string | null {
  if (text.length > 16 || !/^[A-Za-z0-9 -]+$/.test(text)) return null;
  const code = text.replaceAll(/[ -]/g, "").toUpperCase();
  if (code.length !== PAIRING_LENGTH) return null;
  return [...code].every((char) => PAIRING_ALPHABET.includes(char)) ? code : null;
}
export function formatPairingCode(code: string) {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
// Keyed: a plain hash of a 6-character code is brute-forced offline in seconds.
export function pairingHash(code: string, key: string) {
  return createHmac("sha256", key).update(`pairing:${code}`).digest("hex");
}
export function senderHash(senderId: string, key: string) {
  return createHmac("sha256", key).update(`sender:${senderId}`).digest("hex");
}
const tokenPattern = "[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{32}";
export function parseTelegramText(text: string): TelegramIntent {
  if (text.length > 4096 || text !== text.trim() || /[\r\n]/.test(text)) return { kind: "help" };
  if (text === "/start") return { kind: "start" };
  const start = /^\/start (\S{1,64})$/.exec(text);
  if (start) {
    const code = normalizePairingCode(start[1]!);
    return code ? { kind: "pair", code, explicit: true } : { kind: "bad_code" };
  }
  const code = normalizePairingCode(text);
  if (code) return { kind: "pair", code, explicit: false };
  if (text === "/status") return { kind: "status" };
  if (text === "/unlink") return { kind: "unlink" };
  const action = new RegExp(`^/(answer|approve|skip|undo) (${tokenPattern})$`).exec(text);
  if (action)
    return { kind: "action", token: action[2]!, expectedKind: action[1] as TelegramActionKind };
  const address = text.startsWith("/add ") ? text.slice(5) : text;
  try {
    const url = new URL(address);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      address.length <= 4000 &&
      !/\s/.test(address)
    )
      return { kind: "add", url: url.href };
  } catch {}
  const company = /^(?:stop applying to ([^"\r\n]{1,120})|\/exclude "([^"\r\n]{1,120})")$/.exec(
    text,
  );
  if (company) return { kind: "exclude", company: (company[1] ?? company[2]!).normalize("NFC") };
  return { kind: "help" };
}
export function telegramSender(update: TelegramUpdate) {
  if (Boolean(update.message) === Boolean(update.callback_query)) return null;
  const from = update.callback_query?.from ?? update.message?.from;
  const message = update.callback_query?.message ?? update.message;
  if (
    !from ||
    from.is_bot ||
    !message ||
    message.chat.type !== "private" ||
    message.chat.id !== from.id ||
    message.forward_origin !== undefined ||
    message.forward_from !== undefined ||
    message.via_bot !== undefined
  )
    return null;
  return {
    senderId: String(from.id),
    chatId: String(message.chat.id),
    username: from.username ?? null,
    callbackId: update.callback_query?.id ?? null,
    intent: update.callback_query
      ? { kind: "action" as const, token: update.callback_query.data, expectedKind: null }
      : parseTelegramText(message.text ?? ""),
  };
}
interface TelegramTokenBinding {
  id: string;
  userId: string;
  linkId: string;
  generation: number;
  kind: string;
  targetId: string;
  expectedRevision: number | null;
  expectedHash: string | null;
  payload: unknown;
  expiresAt: Date;
}
export function actionToken(binding: TelegramTokenBinding, secret: string) {
  const identity = Buffer.from(binding.id.replaceAll("-", ""), "hex").toString("base64url");
  const {
    id,
    userId,
    linkId,
    generation,
    kind,
    targetId,
    expectedRevision,
    expectedHash,
    payload,
  } = binding;
  const digest = createHmac("sha256", secret)
    .update(
      telegramCanonical({
        id,
        userId,
        linkId,
        generation,
        kind,
        targetId,
        expectedRevision,
        expectedHash,
        payload,
        expiresAt: binding.expiresAt.toISOString(),
      }),
    )
    .digest()
    .subarray(0, 24)
    .toString("base64url");
  return `${identity}.${digest}`;
}
export function actionId(token: string): string | null {
  if (!new RegExp(`^${tokenPattern}$`).test(token) || Buffer.byteLength(token) > 64) return null;
  const hex = Buffer.from(token.split(".")[0]!, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function quietNow(settings: TelegramSettings, now: Date) {
  if (!settings.quietHours) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const minute =
    Number(parts.find((part) => part.type === "hour")!.value) * 60 +
    Number(parts.find((part) => part.type === "minute")!.value);
  const { startMinute: start, endMinute: end } = settings.quietHours;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
export function digestBucket(settings: TelegramSettings, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return Number(get("hour")) >= settings.digestHour
    ? `${get("year")}-${get("month")}-${get("day")}`
    : null;
}
export function safeTelegramQuestion(category: string, definition: QuestionDefinition) {
  if (
    category !== "contact" ||
    definition.visibility !== "visible" ||
    definition.condition.state !== "unconditional" ||
    definition.condition.rules.length ||
    definition.fields.length !== 1 ||
    definition.description?.trim()
  )
    return null;
  const field = definition.fields[0]!;
  if (
    field.type !== "single_choice" ||
    field.options.some((option) => option.freeText && option.freeText !== "none")
  )
    return null;
  const prompt = definition.prompt.normalize("NFC").trim().replace(/\s+/g, " ");
  if (prompt !== "Preferred contact method?" || field.options.length !== 2) return null;
  if (field.label && field.label.normalize("NFC").trim().replace(/\s+/g, " ") !== prompt)
    return null;
  const labels = field.options.map((option) => option.label);
  if (
    !labels.includes("Email") ||
    !labels.includes("Phone") ||
    new Set(field.options.map((option) => option.value)).size !== 2
  )
    return null;
  return {
    template: "preferred_contact" as const,
    fieldKey: field.key,
    options: field.options.map((option) => ({ label: option.label, value: option.value })),
  };
}
