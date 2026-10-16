import { forbidden } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import type { Prisma } from "@/generated/prisma/client";

export type HumanActor = AuthKind | { kind: "telegram_user"; linkId: string; generation: number };

export function isHumanAuthorship(value: string) {
  return value === "session_user" || value === "telegram_user";
}

// The caller holds the account lock, shared with unlink and pairing generation changes.
export async function assertHumanActor(
  tx: Prisma.TransactionClient,
  userId: string,
  actor: HumanActor,
) {
  if (actor === "session_user") return "session_user" as const;
  if (typeof actor !== "object" || actor.kind !== "telegram_user")
    throw forbidden("Only a verified person can confirm this action.");
  const link = await tx.telegramLink.findFirst({
    where: { id: actor.linkId, userId, generation: actor.generation, active: true },
  });
  if (!link) throw forbidden("The Telegram link is no longer active. Reopen the current action.");
  return "telegram_user" as const;
}
