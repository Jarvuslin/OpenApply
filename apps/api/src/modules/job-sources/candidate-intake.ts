import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { sha256 } from "@/common/crypto/hash";
import { conflict, findOwned } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import type { SourceJob } from "./types";

export function candidateKey(url: string) {
  return `source-${sha256(canonicalizeJobUrl(url))}`;
}

export async function lockDiscovery(
  db: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
) {
  const campaign = await findOwned(
    (where) => db.campaign.findFirst({ where }),
    { campaignId, userId },
    "Campaign",
  );
  const config = campaignConfigSchema.parse(campaign.config);
  if (config.discovery?.phase !== "collecting" || campaign.status !== "in_progress")
    throw conflict(
      "This candidate list is not collecting jobs. Create a new list to discover more jobs.",
    );
  const locked = await db.campaign.updateMany({
    where: { campaignId, userId, updatedAt: campaign.updatedAt },
    data: { updatedAt: new Date(Math.max(Date.now(), campaign.updatedAt.getTime() + 1)) },
  });
  if (!locked.count) throw conflict("Candidate list changed concurrently; retry discovery.");
  return { campaign, config };
}

export async function saveCandidate(
  db: Prisma.TransactionClient,
  campaignId: string,
  job: SourceJob,
  board: string,
  resolution: { applyUrl: string | null; confidence: number },
  maxJobs: number,
) {
  const applyUrl = resolution.applyUrl ? allowedApplyUrl(resolution.applyUrl) : null;
  const url = canonicalizeJobUrl(applyUrl ?? job.attributionUrl);
  const key = candidateKey(url);
  const existing = await db.job.findUnique({ where: { campaignId_key: { campaignId, key } } });
  if (existing) return { saved: false, truncated: false };
  const sourceKey = candidateKey(job.attributionUrl);
  if (applyUrl && sourceKey !== key) {
    const unresolved = await db.job.findUnique({
      where: { campaignId_key: { campaignId, key: sourceKey } },
    });
    if (unresolved?.status === "queued" && unresolved.fitAssessment === null) {
      const description = unresolved.description || job.description;
      await db.job.update({
        where: { id: unresolved.id },
        data: {
          key,
          url,
          description,
          status: description.trim() ? "pending" : "queued",
          retryNotes: description.trim()
            ? null
            : "The source returned no full job description; fetch the employer posting before scoring.",
          digest: JSON.stringify({
            discovery: {
              attributionUrl: job.attributionUrl,
              applyUrl,
              resolutionConfidence: resolution.confidence,
              sourceDescription: description,
            },
          }),
        },
      });
      return { saved: false, truncated: false };
    }
  }
  if ((await db.job.count({ where: { campaignId } })) >= maxJobs)
    return { saved: false, truncated: true };
  let retryNotes: string | null = null;
  if (!job.description.trim())
    retryNotes =
      "The source returned no full job description; fetch the employer posting before scoring.";
  if (!applyUrl)
    retryNotes =
      "Employer application URL is unresolved; the source posting is retained for review.";
  await db.job.create({
    data: {
      campaignId,
      key,
      title: job.title,
      company: job.company,
      location: job.location,
      url,
      board,
      description: job.description,
      status: applyUrl && job.description.trim() ? "pending" : "queued",
      retryNotes,
      digest: JSON.stringify({
        discovery: {
          attributionUrl: job.attributionUrl,
          applyUrl,
          resolutionConfidence: resolution.confidence,
          sourceDescription: job.description,
        },
      }),
    },
  });
  return { saved: true, truncated: false };
}
