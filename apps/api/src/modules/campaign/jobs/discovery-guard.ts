import { campaignConfigSchema } from "@openapply/contracts/campaign";
import type { FitAssessment } from "@openapply/contracts/scoring";
import { conflict } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";

export function discoveryBlockedReason(
  configValue: unknown,
  assessment?: FitAssessment | null,
): string | null {
  const config = campaignConfigSchema.parse(configValue ?? {});
  if (!config.discovery) return null;
  if (config.discovery.phase !== "complete")
    return "Finish collecting and scoring the candidate list before approving or applying.";
  if (config.discovery.intent !== "apply")
    return "This is a preview list. Authorize applying from this list first.";
  if (!assessment)
    return "Every candidate needs a current original-resume/full-JD assessment before applying.";
  if (config.minScore === undefined)
    return "Save a minimum match score for this list before applying.";
  if (assessment.score < config.minScore)
    return "This candidate is below the list's saved minimum match score.";
  if (assessment.roleMatch.relevance === "outside_preferences")
    return "This candidate is outside saved desired roles.";
  if (assessment.roleMatch.relevance === "unclear" || assessment.roleMatch.family === "Unclear")
    return "Resolve the candidate's role before applying.";
  const checks = assessment.preferenceChecks;
  if (!checks)
    return "Complete separate preference and eligibility checks before applying from this list.";
  if (
    [checks.level, checks.location, checks.workMode, checks.employmentType].some(
      (check) => check.status === "mismatch",
    )
  )
    return "This candidate conflicts with a saved job preference.";
  if (checks.eligibility.some((check) => check.status !== "met"))
    return "Resolve explicit eligibility requirements before applying from this list.";
  return null;
}

export function assertDiscoveryReady(configValue: unknown, assessment?: FitAssessment | null) {
  const reason = discoveryBlockedReason(configValue, assessment);
  if (reason) throw conflict(reason);
}

export async function reserveDiscoveryApplication(
  db: Prisma.TransactionClient,
  userId: string,
  job: { id?: string; campaignId: string },
  configValue: unknown,
) {
  const config = campaignConfigSchema.parse(configValue ?? {});
  if (!config.discovery) return;
  // The campaign row serializes workers before counting reservations; a read alone can overshoot.
  const locked = await db.campaign.updateMany({
    where: {
      campaignId: job.campaignId,
      userId,
      status: "in_progress",
      config: { equals: configValue as Prisma.InputJsonValue },
    },
    data: { updatedAt: new Date() },
  });
  if (!locked.count) throw conflict("Candidate list changed or stopped; reload before applying.");
  const reserved = await db.job.count({
    where: {
      campaignId: job.campaignId,
      ...(job.id && { id: { not: job.id } }),
      OR: [
        { status: { in: ["applying", "applied"] } },
        {
          submissionAttempt: {
            is: { OR: [{ startedAt: { not: null } }, { legacyOutcomeUnknown: true }] },
          },
        },
      ],
    },
  });
  if (reserved >= (config.maxApplications ?? 5))
    throw conflict(
      "This candidate list reached its authorized application limit, including active or unconfirmed submissions.",
    );
}

/** A job the person put in the queue themselves skips its search list's bulk-apply rules. */
export async function listRulesApply(db: Prisma.TransactionClient, userId: string, jobId: string) {
  const queued = await db.workItem.count({
    where: { userId, jobId, kind: "application", source: { in: ["user", "mvp"] } },
  });
  return queued === 0;
}
