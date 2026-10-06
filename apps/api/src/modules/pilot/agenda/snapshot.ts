import { type AgendaResponse, agendaResponseSchema } from "@openapply/contracts/pilot";
import { reviveJsonDates } from "@/common/json";
import { Prisma } from "@/generated/prisma/client";

/** Every write that changes an agenda input carries this, or the agent works from a stale agenda. */
export const AGENDA_SNAPSHOT_RESET = {
  agendaVersion: null,
  agendaGeneratedAt: null,
  agendaExpiresAt: null,
  agendaSnapshot: Prisma.DbNull,
} as const;

export function parseAgendaSnapshot(value: unknown): AgendaResponse {
  return agendaResponseSchema.parse(reviveJsonDates(value));
}
