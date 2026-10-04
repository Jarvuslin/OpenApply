import type { TerminalHealth } from "../agent-dock/use-terminal-health";

export const PILOT_STARTING_UP_LABEL = "Starting up - first cycle begins shortly";

export const PILOT_HOST_OFFLINE_MESSAGE =
  "Pilot is running but the terminal host is offline - start the OpenApply agent so cycles can run.";

export function isHostOffline(health: TerminalHealth | null): boolean {
  return health === "offline" || health === "uninstalled";
}
