import type { TelegramUpdate } from "@openapply/contracts/telegram";
import { telegramTestConfig } from "./telegram.fakes";
import { pollOnce, webhookActive } from "./telegram.updates";
import { expect, test } from "bun:test";

const config = { ...telegramTestConfig.telegram!, updates: "polling" as const };
const update = (id: number) => ({
  update_id: id,
  message: {
    message_id: id,
    from: { id: 42, is_bot: false },
    chat: { id: 42, type: "private" },
    text: "/start",
  },
});
function telegram(status: number, body: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetcher, calls };
}

test("polling hands each valid update over and confirms through the next offset", async () => {
  const { fetcher, calls } = telegram(200, {
    ok: true,
    result: [update(7), { update_id: 8, message: { nonsense: true } }, update(9)],
  });
  const accepted: TelegramUpdate[] = [];
  const result = await pollOnce(config, 7, async (item) => void accepted.push(item), fetcher);
  expect(accepted.map((item) => item.update_id)).toEqual([7, 9]);
  expect(result).toEqual({ offset: 10, waitMs: 0, problem: null });
  expect(calls[0]!.url).toEndWith("/getUpdates");
  expect(calls[0]!.body).toMatchObject({
    offset: 7,
    allowed_updates: ["message", "callback_query"],
  });
});

test("an update that fails to save is fetched again instead of skipped", async () => {
  const { fetcher } = telegram(200, { ok: true, result: [update(7), update(8)] });
  const result = await pollOnce(
    config,
    7,
    async (item) => {
      if (item.update_id === 8) throw new Error("database down");
    },
    fetcher,
  );
  expect(result).toEqual({ offset: 8, waitMs: 5_000, problem: "accept_failed" });
});

test("Telegram errors back off: a second poller, rate limits, a bad token, no network", async () => {
  const accept = async () => {};
  expect(await pollOnce(config, 3, accept, telegram(409, { ok: false }).fetcher)).toEqual({
    offset: 3,
    waitMs: 30_000,
    problem: "conflict",
  });
  const limited = telegram(429, { ok: false, parameters: { retry_after: 12 } }).fetcher;
  expect((await pollOnce(config, 3, accept, limited)).waitMs).toBe(12_000);
  expect((await pollOnce(config, 3, accept, telegram(401, { ok: false }).fetcher)).problem).toBe(
    "unauthorized",
  );
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  expect((await pollOnce(config, 3, accept, offline)).problem).toBe("network");
});

test("a bot with a webhook is detected, so local polling leaves production alone", async () => {
  const deployed = telegram(200, { ok: true, result: { url: "https://openapply.example/hook" } });
  expect(await webhookActive(config, deployed.fetcher)).toBe(true);
  expect(deployed.calls[0]!.url).toEndWith("/getWebhookInfo");
  expect(
    await webhookActive(config, telegram(200, { ok: true, result: { url: "" } }).fetcher),
  ).toBe(false);
});
