export interface PendingIntakeAction {
  intakeId: string;
  accountId: string;
  action: "prepare" | "apply_now" | "queue" | "skip";
  revision: number;
  provider: "claude" | "codex" | undefined;
}
export function intakeRequest(
  current: Omit<PendingIntakeAction, "action">,
  action: PendingIntakeAction["action"],
  pending: PendingIntakeAction | null,
): PendingIntakeAction | null {
  if (!current.accountId) return null;
  if (!pending) return { ...current, action };
  if (
    pending.accountId !== current.accountId ||
    pending.intakeId !== current.intakeId ||
    pending.action !== action
  )
    return null;
  // An acknowledgement may be lost after the revision advances. Replay the same payload.
  return pending;
}
