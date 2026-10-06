interface MailboxStatus {
  connected: boolean;
  provider?: string;
  needsReauth?: boolean;
  lastSyncAt?: string | Date | null;
}

/** A saved account or command dispatch alone is not proof of a new connector check. */
export function connectorUpdated(
  status: MailboxStatus,
  previousSync: string | Date | null,
): boolean {
  if (
    !status.connected ||
    status.provider !== "connector" ||
    status.needsReauth ||
    !status.lastSyncAt
  )
    return false;
  const current = new Date(status.lastSyncAt).getTime();
  const previous = previousSync ? new Date(previousSync).getTime() : 0;
  return Number.isFinite(current) && Number.isFinite(previous) && current > previous;
}
