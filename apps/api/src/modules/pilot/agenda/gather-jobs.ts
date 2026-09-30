import { campaignConfigSchema } from "@jobpilot/contracts/campaign";
import type { AgendaPayload } from "@jobpilot/contracts/pilot";
import { HOUR_MS } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";
import { GATHER_CAP, jobSubjectId, withoutRecentClaims } from "./claims";

const WARM_INTRO_MIN_SCORE = 80;
/** "I just applied" outreach still lands this long after the apply. */
const WARM_INTRO_APPLIED_WINDOW_MS = 48 * HOUR_MS;
const BOARD_HEALTH_SCAN = 500;
const BOARD_HEALTH_MIN_FAILURES = 3;
const FAIL_REASON_CAP = 3;

type WarmContact = NonNullable<AgendaPayload<"job.apply">["warmContacts"]>[number];

/** An approved or recently applied job, carrying what both apply and warm-intro items need. */
export interface AgendaJob {
  campaignId: string;
  key: string;
  title: string;
  url: string;
  board: string | null;
  digest: string | null;
  matchScore: number | null;
  company: string | null;
  resumeId?: string;
  warmContacts?: WarmContact[];
}

/** Approved jobs of in-progress campaigns, best match first. */
export async function gatherApprovedJobs(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaJob[]> {
  const rows = await prisma.job.findMany({
    where: { status: "approved", campaign: { userId, status: "in_progress" } },
    orderBy: { matchScore: "desc" },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      key: true,
      title: true,
      url: true,
      board: true,
      digest: true,
      matchScore: true,
      company: true,
      campaign: { select: { config: true } },
    },
  });
  return rows.map(({ campaign, ...job }) => ({
    ...job,
    resumeId: campaignConfigSchema.parse(campaign.config).resumeId,
  }));
}

/**
 * Strong approved matches plus recent applies. Applying outranks the intro, so without the applied
 * half the pool would drain before an intro ever fires.
 */
export async function gatherWarmIntroCandidates(
  prisma: PrismaClient,
  userId: string,
  now: Date,
  approvedJobs: AgendaJob[],
): Promise<AgendaJob[]> {
  const applied = await prisma.job.findMany({
    where: {
      status: "applied",
      appliedAt: { gte: new Date(now.getTime() - WARM_INTRO_APPLIED_WINDOW_MS) },
      matchScore: { gte: WARM_INTRO_MIN_SCORE },
      campaign: { userId },
    },
    orderBy: { matchScore: "desc" },
    take: GATHER_CAP,
    select: {
      campaignId: true,
      key: true,
      title: true,
      url: true,
      matchScore: true,
      company: true,
    },
  });
  const candidates: AgendaJob[] = [
    ...approvedJobs.filter((job) => (job.matchScore ?? 0) >= WARM_INTRO_MIN_SCORE),
    ...applied.map((job) => ({ ...job, board: null, digest: null })),
  ];
  const claimable = await withoutRecentClaims(
    prisma,
    userId,
    "networking.warmIntro",
    now,
    WARM_INTRO_APPLIED_WINDOW_MS,
    candidates,
    jobSubjectId,
  );
  return claimable.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}

/** Names same-company contacts on each job, at any score: one read covers every job. */
export async function attachWarmContacts(
  prisma: PrismaClient,
  userId: string,
  jobs: AgendaJob[],
): Promise<void> {
  const withCompany = jobs.filter((job) => job.company);
  if (withCompany.length === 0) return;

  const rows = await prisma.contact.findMany({
    where: { userId, email: { not: null }, company: { not: null } },
    orderBy: { createdAt: "desc" },
    take: GATHER_CAP,
    select: { id: true, name: true, title: true, email: true, company: true },
  });
  const contacts = rows
    .map(({ company, ...contact }) => ({ contact, company: normalizeCompanyName(company ?? "") }))
    .filter(({ company }) => company.length > 0);

  for (const job of withCompany) {
    const target = normalizeCompanyName(job.company ?? "");
    if (!target) continue;
    const matches = contacts
      .filter(({ company }) => company.includes(target) || target.includes(company))
      .map(({ contact }) => contact);
    if (matches.length > 0) job.warmContacts = matches;
  }
}

/** Boards whose latest apply outcomes are a failure streak, longest streak first. */
export async function gatherBoardHealth(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"board.health">[]> {
  const rows = await prisma.job.findMany({
    where: { status: { in: ["applied", "failed"] }, board: { not: null }, campaign: { userId } },
    orderBy: { createdAt: "desc" },
    take: BOARD_HEALTH_SCAN,
    select: { campaignId: true, key: true, url: true, board: true, status: true, failReason: true },
  });

  const unhealthy: AgendaPayload<"board.health">[] = [];
  for (const [board, jobs] of Map.groupBy(rows, (row) => row.board ?? "")) {
    const firstSuccess = jobs.findIndex((job) => job.status !== "failed");
    const failed = firstSuccess === -1 ? jobs : jobs.slice(0, firstSuccess);
    if (failed.length < BOARD_HEALTH_MIN_FAILURES) continue;

    const probe = failed[0];
    unhealthy.push({
      board,
      consecutiveFailures: failed.length,
      recentFailReasons: failed
        .flatMap((job) => (job.failReason ? [job.failReason] : []))
        .slice(0, FAIL_REASON_CAP),
      probeJob: { campaignId: probe.campaignId, jobKey: probe.key, url: probe.url },
    });
  }
  return unhealthy.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}
