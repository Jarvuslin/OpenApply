import { z } from "zod/v4";
import { HOUR_MS } from "@/common/date/buckets";
import type {
  Job,
  PilotClaim,
  PilotClaimOutcome,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";

/** Row cap for the unbounded gather and expiry scans. */
export const GATHER_CAP = 200;

/** A crash (expired/abandoned claim) was not a decision, so it retries sooner than any cooldown. */
const CRASH_RETRY_MS = 2 * HOUR_MS;

/** Outcomes that mean the agent never finished, as opposed to deciding. */
export const CRASH_OUTCOMES = ["expired", "abandoned"] satisfies PilotClaimOutcome[];

export function isCrash(outcome: PilotClaimOutcome | null): boolean {
  return outcome === "expired" || outcome === "abandoned";
}

type ClaimHistory = Pick<PilotClaim, "grantedAt" | "releasedAt" | "outcome">;

type JobRef = Pick<Job, "campaignId" | "key">;

const HISTORY_SELECT = { grantedAt: true, releasedAt: true, outcome: true } as const;

export function latestClaim(prisma: PrismaClient, userId: string, kind: string) {
  return prisma.pilotClaim.findFirst({
    where: { userId, kind },
    orderBy: { grantedAt: "desc" },
    select: HISTORY_SELECT,
  });
}

/** Newest claim of one kind per subject, in one read. */
export async function latestClaimBySubject(
  prisma: PrismaClient,
  userId: string,
  kind: string,
  subjectIds: string[],
): Promise<Map<string, ClaimHistory>> {
  const claims = await prisma.pilotClaim.findMany({
    where: { userId, kind, subjectId: { in: subjectIds } },
    orderBy: { grantedAt: "desc" },
    take: GATHER_CAP,
    select: { subjectId: true, ...HISTORY_SELECT },
  });
  const latest = new Map<string, ClaimHistory>();
  for (const { subjectId, ...claim } of claims) {
    if (!latest.has(subjectId)) latest.set(subjectId, claim);
  }
  return latest;
}

/** An open claim is still running; a released one holds the subject back for `cooldownMs`. */
export function claimDamped(
  last: ClaimHistory | null | undefined,
  now: Date,
  cooldownMs: number,
): boolean {
  if (!last) return false;
  if (!last.releasedAt) return true;
  const cooldown = isCrash(last.outcome) ? Math.min(cooldownMs, CRASH_RETRY_MS) : cooldownMs;
  return now.getTime() - last.releasedAt.getTime() < cooldown;
}

/** Drops the rows whose subject a claim of `kind` still holds back. */
export async function withoutRecentClaims<T>(
  prisma: PrismaClient,
  userId: string,
  kind: string,
  now: Date,
  cooldownMs: number,
  rows: T[],
  subjectOf: (row: T) => string,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const latest = await latestClaimBySubject(prisma, userId, kind, rows.map(subjectOf));
  return rows.filter((row) => !claimDamped(latest.get(subjectOf(row)), now, cooldownMs));
}

/** A job's claim subject. Every producer and damper read must agree on it byte for byte. */
export function jobSubjectId(job: JobRef): string {
  return `${job.campaignId}:${job.key}`;
}

/** The inverse of {@link jobSubjectId}, for question subjects written the same way. */
export function parseJobSubject(subjectId: string): JobRef {
  const separator = subjectId.indexOf(":");
  if (separator <= 0 || separator === subjectId.length - 1) {
    throw new Error(`Invalid job subject: ${subjectId}`);
  }
  return { campaignId: subjectId.slice(0, separator), key: subjectId.slice(separator + 1) };
}

const jobRefSchema = z.object({ campaignId: z.string().min(1), jobKey: z.string().min(1) });

/** The job a `job.apply` claim payload points at. */
export function parseJobRef(payload: unknown): JobRef {
  const { campaignId, jobKey } = jobRefSchema.parse(payload);
  return { campaignId, key: jobKey };
}

/** Hands jobs whose apply never finished back to the approved queue. */
export async function revertApplyingJobs(
  tx: Prisma.TransactionClient,
  userId: string,
  jobs: JobRef[],
): Promise<void> {
  if (jobs.length === 0) return;
  await tx.job.updateMany({
    where: { status: "applying", campaign: { userId }, OR: jobs },
    data: { status: "approved" },
  });
}
