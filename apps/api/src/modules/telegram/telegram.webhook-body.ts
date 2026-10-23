import { telegramUpdateSchema } from "@openapply/contracts/telegram";
import { badRequest, unauthorized } from "@/common/errors";
import { equalSecret } from "./telegram.policy";
export async function readTelegramUpdate(
  request: Request,
  secret: string | null,
  timeoutMs = 10000,
) {
  if (
    !secret ||
    !equalSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? undefined, secret)
  )
    throw unauthorized("Invalid Telegram webhook authentication.");
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("Invalid Telegram update.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(badRequest("Telegram update timed out."));
    }, timeoutMs);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 64000) {
        void reader.cancel().catch(() => {});
        throw badRequest("Telegram update exceeds the permitted size.");
      }
      chunks.push(part.value);
    }
    const parsed = telegramUpdateSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!parsed.success) throw badRequest("Invalid Telegram update.");
    return parsed.data;
  } catch {
    throw badRequest("Invalid Telegram update.");
  } finally {
    clearTimeout(timer);
  }
}
