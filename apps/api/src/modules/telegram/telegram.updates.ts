import { type TelegramUpdate, telegramUpdateSchema } from "@openapply/contracts/telegram";
import type { TelegramConfigHolder } from "./telegram.config";

type Config = NonNullable<TelegramConfigHolder["telegram"]>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const LONG_POLL_SECONDS = 25;

interface PollResult {
  offset: number;
  /** How long to wait before the next call; 0 continues immediately. */
  waitMs: number;
  problem: "conflict" | "rate_limited" | "unauthorized" | "network" | "accept_failed" | null;
}

async function call(
  config: Config,
  method: string,
  body: object,
  fetcher: Fetcher,
  timeoutMs: number,
) {
  const response = await fetcher(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const value = (await response.json().catch(() => null)) as {
    ok?: unknown;
    result?: unknown;
    parameters?: { retry_after?: unknown };
  } | null;
  return { status: response.status, value };
}

/** Polling and a webhook cannot share a bot: true means this bot belongs to a deployed server. */
export async function webhookActive(config: Config, fetcher: Fetcher = fetch) {
  const { value } = await call(config, "getWebhookInfo", {}, fetcher, 10_000);
  if (value?.ok !== true) throw new Error("Telegram getWebhookInfo failed.");
  const url = (value.result as { url?: unknown } | undefined)?.url;
  return typeof url === "string" && url.length > 0;
}

/**
 * One long-poll round. Telegram confirms updates below the offset sent next, so the offset only
 * advances past updates that were accepted or are unusable; a failed accept is fetched again.
 */
export async function pollOnce(
  config: Config,
  offset: number,
  accept: (update: TelegramUpdate) => Promise<void>,
  fetcher: Fetcher = fetch,
): Promise<PollResult> {
  let status: number;
  let value: Awaited<ReturnType<typeof call>>["value"];
  try {
    ({ status, value } = await call(
      config,
      "getUpdates",
      { offset, timeout: LONG_POLL_SECONDS, allowed_updates: ["message", "callback_query"] },
      fetcher,
      (LONG_POLL_SECONDS + 10) * 1000,
    ));
  } catch {
    return { offset, waitMs: 5_000, problem: "network" };
  }
  if (status === 409) return { offset, waitMs: 30_000, problem: "conflict" };
  if (status === 429) {
    const retry = value?.parameters?.retry_after;
    const seconds = typeof retry === "number" && retry > 0 ? Math.min(retry, 3600) : 30;
    return { offset, waitMs: seconds * 1000, problem: "rate_limited" };
  }
  if (status === 401 || status === 404) return { offset, waitMs: 60_000, problem: "unauthorized" };
  if (value?.ok !== true || !Array.isArray(value.result))
    return { offset, waitMs: 5_000, problem: "network" };
  let next = offset;
  for (const raw of value.result as { update_id?: unknown }[]) {
    if (typeof raw?.update_id !== "number" || raw.update_id < next) continue;
    const parsed = telegramUpdateSchema.safeParse(raw);
    if (parsed.success) {
      try {
        await accept(parsed.data);
      } catch {
        return { offset: next, waitMs: 5_000, problem: "accept_failed" };
      }
    }
    next = raw.update_id + 1;
  }
  return { offset: next, waitMs: 0, problem: null };
}
