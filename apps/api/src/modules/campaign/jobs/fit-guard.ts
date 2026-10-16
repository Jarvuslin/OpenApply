import type { FitAssessment } from "@openapply/contracts/scoring";
import { conflict } from "@/common/errors";
import type { Job, Prisma } from "@/generated/prisma/client";
import type { ScoringService } from "@/modules/scoring/scoring.service";

export async function assertCurrentFit(
  scoring: Pick<ScoringService, "currentAssessment">,
  userId: string,
  job: Pick<Job, "campaignId" | "key" | "fitAssessment">,
  required = false,
  db?: Prisma.TransactionClient,
): Promise<FitAssessment | null> {
  // A manually selected, unscored job must reach the worker to read its full posting.
  if (job.fitAssessment === null && !required) return null;
  const assessment = await scoring.currentAssessment(
    userId,
    {
      campaignId: job.campaignId,
      jobKey: job.key,
    },
    db,
  );
  if (!assessment) {
    throw conflict(
      "Score this job against the current original resume, posting and preferences before approving or applying.",
    );
  }
  if (assessment.roleMatch.relevance === "outside_preferences") {
    throw conflict(
      "This job is outside the saved desired roles. Update the job or preferences and rescore before applying.",
    );
  }
  if (assessment.roleMatch.family === "Unclear" || assessment.roleMatch.relevance === "unclear") {
    throw conflict(
      "Inspect the full posting to resolve its role before approving or applying. Refresh changed job details and rescore; ask only for a genuinely unresolved applicant fact or preference.",
    );
  }
  return assessment;
}
