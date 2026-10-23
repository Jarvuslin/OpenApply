import { inject, singleton } from "tsyringe";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";

export interface TelegramMessage {
  chatId: string;
  text: string;
  silent?: boolean;
  buttons?: { text: string; callback_data?: string; url?: string }[][];
}
type TelegramSendResult =
  | { state: "sent"; messageId: string }
  | {
      state: "failed" | "unknown";
      code: "disabled" | "rejected" | "rate_limited" | "transport_unknown";
      retryAfterSeconds?: number;
    };
export async function sendTelegram(
  config: TelegramConfigHolder["telegram"],
  message: TelegramMessage,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<TelegramSendResult> {
  if (!config?.deliveryEnabled) return { state: "failed", code: "disabled" };
  if (
    !/^\d{1,20}$/.test(message.chatId) ||
    message.text.length < 1 ||
    message.text.length > 4096 ||
    (message.buttons?.flat().length ?? 0) > 8
  )
    return { state: "failed", code: "rejected" };
  for (const button of message.buttons?.flat() ?? []) {
    if (
      button.text.length < 1 ||
      button.text.length > 64 ||
      Boolean(button.callback_data) === Boolean(button.url)
    )
      return { state: "failed", code: "rejected" };
    if (
      button.callback_data &&
      (Buffer.byteLength(button.callback_data) < 1 || Buffer.byteLength(button.callback_data) > 64)
    )
      return { state: "failed", code: "rejected" };
    if (button.url) {
      try {
        const url = new URL(button.url);
        if (url.origin !== new URL(config.webUrl).origin || url.username || url.password)
          return { state: "failed", code: "rejected" };
      } catch {
        return { state: "failed", code: "rejected" };
      }
    }
  }
  try {
    const response = await fetcher(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chatId,
        text: message.text,
        link_preview_options: { is_disabled: true },
        disable_notification: message.silent !== false,
        protect_content: true,
        ...(message.buttons?.length ? { reply_markup: { inline_keyboard: message.buttons } } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const reader = response.body?.getReader();
    if (!reader) return { state: "unknown", code: "transport_unknown" };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64000) {
        await reader.cancel();
        return { state: "unknown", code: "transport_unknown" };
      }
      chunks.push(part.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return { state: "unknown", code: "transport_unknown" };
    const body = value as {
      ok?: unknown;
      result?: { message_id?: unknown };
      error_code?: unknown;
      parameters?: { retry_after?: unknown };
    };
    if (
      response.ok &&
      body.ok === true &&
      typeof body.result?.message_id === "number" &&
      Number.isSafeInteger(body.result.message_id) &&
      body.result.message_id > 0
    )
      return { state: "sent", messageId: String(body.result.message_id) };
    if (body.ok === false && response.status === 429 && body.error_code === 429) {
      const retry = body.parameters?.retry_after;
      return {
        state: "failed",
        code: "rate_limited",
        retryAfterSeconds:
          typeof retry === "number" && Number.isInteger(retry) && retry > 0
            ? Math.min(retry, 3600)
            : 60,
      };
    }
    if (
      body.ok === false &&
      [400, 401, 403, 404].includes(response.status) &&
      body.error_code === response.status
    )
      return { state: "failed", code: "rejected" };
    return { state: "unknown", code: "transport_unknown" };
  } catch {
    return { state: "unknown", code: "transport_unknown" };
  }
}
@singleton()
export class TelegramTransport {
  constructor(@inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder) {}
  send(message: TelegramMessage) {
    return sendTelegram(this.config.telegram, message);
  }
}
