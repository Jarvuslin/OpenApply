import { equalSecret } from "./telegram.policy";
import { readTelegramUpdate } from "./telegram.webhook-body";
import { expect, test } from "bun:test";

const secret = "synthetic-webhook-secret-for-test-only";
test("webhook authenticates before reading body and rejects malformed UTF-8 length secrets", async () => {
  expect(equalSecret("é", "x")).toBe(false);
  expect(equalSecret("a".repeat(513), "a".repeat(513))).toBe(false);
  const request = new Request("http://localhost/webhook", {
    method: "POST",
    body: '{"private":"never read"}',
  });
  await expect(readTelegramUpdate(request, secret)).rejects.toThrow("authentication");
  expect(request.bodyUsed).toBe(false);
});
test("webhook rejects bounded oversized and malformed bodies without reflecting any content", async () => {
  for (const body of ['{"text":"private-bad-input"', "x".repeat(64001)]) {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body,
    });
    await expect(readTelegramUpdate(request, secret)).rejects.toThrow("Invalid Telegram update.");
  }
  const request = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({
      update_id: 3,
      untrusted: "must not persist",
      message: {
        message_id: 4,
        from: { id: 42, is_bot: false },
        chat: { id: 42, type: "private" },
        text: "/status",
        last_name: "private",
      },
    }),
  });
  const parsed = await readTelegramUpdate(request, secret);
  expect(JSON.stringify(parsed)).not.toContain("last_name");
  expect(JSON.stringify(parsed)).not.toContain("untrusted");
  expect(parsed.update_id).toBe(3);
});
test("a stalled authenticated webhook body is cancelled within its bounded deadline", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body,
  });
  await expect(readTelegramUpdate(request, secret, 10)).rejects.toThrow("Invalid Telegram update.");
  expect(cancelled).toBe(true);
});
