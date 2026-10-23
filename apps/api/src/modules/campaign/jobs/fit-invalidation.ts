import type { PatchCampaignJobInput } from "@openapply/contracts/campaign";
import { type Job, Prisma } from "@/generated/prisma/client";

const SCORING_FIELDS = ["title", "company", "location", "type", "description"] as const;

export function fitInvalidation(
  existing: Pick<Job, (typeof SCORING_FIELDS)[number]>,
  fields: PatchCampaignJobInput,
): Prisma.JobUpdateManyMutationInput {
  const changed = SCORING_FIELDS.some(
    (field) => fields[field] !== undefined && fields[field] !== existing[field],
  );
  return changed ? { fitAssessment: Prisma.DbNull, matchScore: null, matchReason: null } : {};
}
