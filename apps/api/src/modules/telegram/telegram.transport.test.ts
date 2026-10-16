import "reflect-metadata";
import { sendTelegram } from "./telegram.transport";
import { expect, test } from "bun:test";

const config = {
  botToken: "123:synthetic-not-a-real-bot-token",
  botUsername: "synthetic_bot",
  webhookSecret: "synthetic-secret-never-external",
  pairingKey: "synthetic-pairing-key-never-external-000",
  updates: "webhook" as const,
  deliveryEnabled: true,
  webUrl: "https://openapply.example",
};
const message = {
  chatId: "42",
  text: "A saved item needs review.",
  buttons: [[{ text: "Open OpenApply", url: "https://openapply.example/needs-you" }]],
};
test("disabled transport never calls fetch even when configured", async () => {
  let calls = 0;
  expect(
    await sendTelegram({ ...config, deliveryEnabled: false }, message, async () => {
      calls++;
      throw Error();
    }),
  ).toEqual({ state: "failed", code: "disabled" });
  expect(calls).toBe(0);
});
test("outbound request uses fixed HTTPS sendMessage with no paid broadcasts or text parse mode", async () => {
  const result = await sendTelegram(config, message, async (url, options) => {
    expect(String(url)).toBe(`https://api.telegram.org/bot${config.botToken}/sendMessage`);
    const body = JSON.parse(String(options?.body));
    expect(body.allow_paid_broadcast).toBeUndefined();
    expect(body.parse_mode).toBeUndefined();
    expect(body.protect_content).toBe(true);
    expect(options?.redirect).toBe("error");
    return new Response(JSON.stringify({ ok: true, result: { message_id: 81 } }));
  });
  expect(result).toEqual({ state: "sent", messageId: "81" });
});
test("timeouts malformed results and server errors remain unknown with no retry claim", async () => {
  for (const fake of [
    async () => {
      throw Error("private token in simulated network failure");
    },
    async () => new Response("not-json"),
    async () => new Response(JSON.stringify({ ok: false, error_code: 500 }), { status: 500 }),
  ])
    expect(await sendTelegram(config, message, fake)).toEqual({
      state: "unknown",
      code: "transport_unknown",
    });
});
test("only explicit Telegram rejection/rate limit is known not delivered", async () => {
  expect(
    await sendTelegram(
      config,
      message,
      async () =>
        new Response(
          JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 5 } }),
          { status: 429 },
        ),
    ),
  ).toEqual({ state: "failed", code: "rate_limited", retryAfterSeconds: 5 });
  expect(
    await sendTelegram(
      config,
      message,
      async () => new Response(JSON.stringify({ ok: false, error_code: 403 }), { status: 403 }),
    ),
  ).toEqual({ state: "failed", code: "rejected" });
});
test("response streaming cancels at its bound and only trusted blocker templates request notification", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(64001));
    },
    cancel() {
      cancelled = true;
    },
  });
  expect(
    await sendTelegram(config, { ...message, silent: false }, async (_url, options) => {
      expect(JSON.parse(String(options.body)).disable_notification).toBe(false);
      return new Response(body);
    }),
  ).toEqual({ state: "unknown", code: "transport_unknown" });
  expect(cancelled).toBe(true);
});
