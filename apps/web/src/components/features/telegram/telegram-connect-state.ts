import type { TelegramPairing } from "@openapply/contracts/telegram";

interface StatusSnapshot {
  configured: boolean;
  link: { id: string; linkedAt: Date; username: string | null } | null;
  pairing: { id: string; expiresAt: Date } | null;
}

type ConnectState =
  | { kind: "not_configured" }
  | { kind: "connected"; label: string; linkedAt: Date }
  | { kind: "showing"; pairing: TelegramPairing; secondsLeft: number }
  | { kind: "expired" }
  /** A code is live, but it was created in another browser, so its text is not here. */
  | { kind: "elsewhere" }
  | { kind: "idle" };

/** Which part of the connect card to show; pure so the polling page logic is testable. */
export function connectState(
  status: StatusSnapshot,
  stored: TelegramPairing | null,
  now: number,
): ConnectState {
  if (!status.configured) return { kind: "not_configured" };
  if (status.link)
    return {
      kind: "connected",
      label: status.link.username
        ? `Connected as @${status.link.username}`
        : "Connected to Telegram",
      linkedAt: status.link.linkedAt,
    };
  if (stored) {
    const secondsLeft = Math.ceil((new Date(stored.expiresAt).getTime() - now) / 1000);
    if (secondsLeft <= 0) return { kind: "expired" };
    if (!status.pairing || status.pairing.id === stored.pairingId)
      return { kind: "showing", pairing: stored, secondsLeft };
  }
  return status.pairing ? { kind: "elsewhere" } : { kind: "idle" };
}

export function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// One code per account across tabs: tabs share it through storage instead of each making one.
const storageKey = (userId: string) => `openapply.telegram-pairing.${userId}`;

export function readStoredPairing(userId: string): TelegramPairing | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as TelegramPairing;
    return { ...value, expiresAt: new Date(value.expiresAt) };
  } catch {
    return null;
  }
}

export function storePairing(userId: string, pairing: TelegramPairing | null) {
  try {
    if (pairing) localStorage.setItem(storageKey(userId), JSON.stringify(pairing));
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* Storage can be blocked; the code then lives only in this tab. */
  }
}
