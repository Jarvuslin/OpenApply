import { conflict, ErrorCodes, HttpError } from "@/common/errors";
import type { Job, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  type AppliedDuplicate,
  type DuplicateReader,
  duplicateSkipReason,
  findAppliedDuplicate,
} from "@/modules/application/duplicate";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import { findFuzzyDuplicate } from "@/modules/scoring/applied-duplicates";
import { publishStatusChange } from "./job-events";

type GuardReader = DuplicateReader & Pick<Prisma.TransactionClient, "job">;

export interface JobPosting {
  campaignId: string;
  key: string;
  url: string;
  title: string;
  company: string;
}

/** A profile never has more than a handful of applies open at once. */
const MAX_APPLYING = 100;

export class AlreadyAppliedError extends HttpError {
  constructor(
    readonly duplicate: AppliedDuplicate,
    readonly job: JobPosting,
    /** Whether the job was then recorded as skipped. */
    recorded = false,
  ) {
    const { title, company, appliedAt } = duplicate.application;
    const day = appliedAt.toISOString().slice(0, 10);
    const tail = recorded ? " The job has been recorded as skipped with this reason;" : "";
    super(
      ErrorCodes.CONFLICT,
      `${duplicateSkipReason(duplicate)}: this profile applied to "${title}" at ${company} on ${day}.${tail} do not apply again.`,
      409,
    );
    this.name = "AlreadyAppliedError";
  }
}

/**
 * An `applying` sibling of the same posting. `Application` rows land only when the result is
 * recorded, so until then the applied-duplicate rule cannot see an apply in progress.
 */
async function findApplyingSibling(
  db: Pick<Prisma.TransactionClient, "job">,
  userId: string,
  job: JobPosting,
): Promise<JobPosting | null> {
  const others = await db.job.findMany({
    where: {
      status: "applying",
      campaign: { userId },
      NOT: { campaignId: job.campaignId, key: job.key },
    },
    take: MAX_APPLYING,
    select: { campaignId: true, key: true, url: true, title: true, company: true },
  });

  const canonical = canonicalizeJobUrl(job.url);
  const sameUrl = others.find((other) => canonicalizeJobUrl(other.url) === canonical);
  if (sameUrl) {
    return sameUrl;
  }

  const idOf = (other: JobPosting) => `${other.campaignId}:${other.key}`;
  const fuzzy = findFuzzyDuplicate(
    job,
    others.map((other) => ({ ...other, id: idOf(other), appliedAt: new Date() })),
  );
  return others.find((other) => idOf(other) === fuzzy?.candidate.id) ?? null;
}

/**
 * Refuses a move into `applying` for a posting this profile already applied to or is applying to.
 * An applied duplicate throws `AlreadyAppliedError`, which `guardApply` turns into a skip; an
 * `applying` sibling only refuses, since that apply may still fail.
 */
export async function assertNotDuplicateApply(
  db: GuardReader,
  userId: string,
  job: JobPosting,
): Promise<void> {
  assertAutomationAllowed(job.url);
  const sibling = await findApplyingSibling(db, userId, job);
  if (sibling) {
    throw conflict(
      `Already applying: another worker holds "${sibling.title}" at ${sibling.company} (${sibling.campaignId}/${sibling.key}). Record this job as skipped with reason "Already applied (in-flight)" instead of applying alongside it.`,
    );
  }

  const duplicate = await findAppliedDuplicate(db, userId, job);
  if (duplicate) {
    throw new AlreadyAppliedError(duplicate, job);
  }
}

/**
 * Runs a move into `applying`. On a duplicate the move has rolled back, so the job is skipped
 * here - otherwise it stays `approved` and the next agenda offers the same duplicate again.
 */
export async function guardApply<T>(
  prisma: PrismaClient,
  userId: string,
  move: () => Promise<T>,
): Promise<T> {
  try {
    return await move();
  } catch (error) {
    if (!(error instanceof AlreadyAppliedError)) throw error;

    const { campaignId, key } = error.job;
    const [skipped] = await prisma.job.updateManyAndReturn({
      where: { campaignId, key, status: { in: ["approved", "needs_user"] } },
      data: { status: "skipped", skipReason: duplicateSkipReason(error.duplicate) },
    });
    if (skipped) {
      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { campaignId },
        select: { source: true },
      });
      await publishStatusChange(prisma, userId, skipped, campaign.source);
    }
    throw new AlreadyAppliedError(error.duplicate, error.job, skipped !== undefined);
  }
}

/** Moves an approved job into `applying` inside the caller's transaction; wrap it in `guardApply`. */
export async function claimJobForApply(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  key: string,
): Promise<Job> {
  const where = {
    campaignId,
    key,
    status: "approved",
    campaign: { userId },
  } satisfies Prisma.JobWhereInput;

  const target = await tx.job.findFirst({
    where,
    select: { url: true, title: true, company: true },
  });
  if (!target) throw conflict("Job is no longer approved.");
  await assertNotDuplicateApply(tx, userId, { ...target, campaignId, key });

  // An empty result is the lost race.
  const [claimed] = await tx.job.updateManyAndReturn({ where, data: { status: "applying" } });
  if (!claimed) throw conflict("Job is no longer approved.");
  return claimed;
}
