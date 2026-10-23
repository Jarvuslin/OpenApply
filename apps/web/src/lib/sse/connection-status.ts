import type { ConnectionStatus } from "./shared-transport";

export function streamResumed(previous: ConnectionStatus, current: ConnectionStatus) {
  return current === "open" && (previous === "waiting" || previous === "reconnecting");
}
