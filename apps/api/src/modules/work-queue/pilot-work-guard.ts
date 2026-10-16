import { pilotInstructionsConfigSchema } from "@openapply/contracts/pilot";
import { startOfDay } from "@/common/date/buckets";
import type { Prisma } from "@/generated/prisma/client";

export async function pilotWorkBlockedReason(
  tx: Prisma.TransactionClient,
  userId: string,
  item: { source: string; kind: string },
  heldReservations = 0,
) {
  if (item.source !== "pilot") return null;
  const state = await tx.pilotState.findUnique({ where: { userId } });
  if (!state?.running) return "Pilot is stopped. This work stays queued until Pilot is enabled.";
  if (item.kind !== "application") return null;
  const { dailyApplyCap } = pilotInstructionsConfigSchema.parse(state.instructionsConfig);
  const applied = await tx.application.count({
    where: { userId, appliedAt: { gte: startOfDay(new Date()) } },
  });
  const pending = await tx.submissionAttempt.count({
    where: {
      userId,
      recordedAt: null,
      OR: [{ startedAt: { not: null } }, { legacyOutcomeUnknown: true }],
    },
  });
  if (applied + pending + heldReservations >= dailyApplyCap)
    return "Pilot's daily application limit is reserved by recorded or unresolved submissions. This work stays queued.";
  return null;
}
