import { connectState, formatCountdown } from "./telegram-connect-state";
import { expect, test } from "bun:test";

const now = Date.parse("2026-10-14T12:00:00Z");
const pairing = {
  pairingId: "a7c0d9a4-6b9e-4d3c-9a43-0d1c6f3b2e10",
  code: "K7P-4QX",
  expiresAt: new Date(now + 90_000),
  startUrl: "https://t.me/OpenApplyBot?start=K7P4QX",
};
const idle = { configured: true, link: null, pairing: null };

test("an unconfigured server shows only that, whatever else is cached", () => {
  expect(connectState({ ...idle, configured: false }, pairing, now).kind).toBe("not_configured");
});

test("a link wins over a live code and falls back when Telegram has no username", () => {
  const linkedAt = new Date(now);
  expect(
    connectState({ ...idle, link: { id: "l", linkedAt, username: "jordan" } }, pairing, now),
  ).toEqual({ kind: "connected", label: "Connected as @jordan", linkedAt });
  expect(
    connectState({ ...idle, link: { id: "l", linkedAt, username: null } }, null, now),
  ).toMatchObject({ label: "Connected to Telegram" });
});

test("this browser's code shows with a countdown until it expires", () => {
  const live = { ...idle, pairing: { id: pairing.pairingId, expiresAt: pairing.expiresAt } };
  expect(connectState(live, pairing, now)).toEqual({ kind: "showing", pairing, secondsLeft: 90 });
  expect(connectState(live, pairing, now + 90_000).kind).toBe("expired");
  expect(formatCountdown(90)).toBe("1:30");
  expect(formatCountdown(9)).toBe("0:09");
});

test("a code made in another browser is not regenerated silently; no code means idle", () => {
  const other = { ...idle, pairing: { id: "someone-else", expiresAt: new Date(now + 60_000) } };
  expect(connectState(other, null, now).kind).toBe("elsewhere");
  expect(connectState(other, pairing, now).kind).toBe("elsewhere");
  expect(connectState(idle, null, now).kind).toBe("idle");
});
