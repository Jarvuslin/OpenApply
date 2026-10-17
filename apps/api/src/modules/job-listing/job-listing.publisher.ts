import { singleton } from "tsyringe";
import { isPrismaError, PRISMA_ERRORS } from "@/common/errors";
import { logger } from "@/common/logger";
import { PrismaClient } from "@/generated/prisma/client";
import { CompanyLogoService } from "./company-logo.service";
import { canonicalizeUrl } from "./dedupe";
import { linkListingApplications } from "./listing-applications";
import { buildListingDraft, type ListingDraft, type ListingSourceJob } from "./listing-draft";
import { boardConflict, fuzzyMatch } from "./listing-match";

/** What a publish did. The seed reports on these; the write-through callers ignore them. */
export type PublishOutcome = "created" | "merged" | "refreshed" | "skipped";

/** Publishing is fire-and-forget, so nothing throttles it - without a ceiling a burst of job writes
 *  would let background work monopolize the pool and stall the request handlers sharing it. */
const MAX_CONCURRENT = 4;

/** Past this the producer is hopelessly ahead; drop rather than grow the queue without bound. */
const MAX_QUEUED = 500;

const MATCH_SELECT = {
  id: true,
  isPublic: true,
  postedAt: true,
  sourceRank: true,
  companyId: true,
  descriptionExcerpt: true,
  sources: { select: { boardKey: true, externalId: true } },
} as const;

interface MatchedListing {
  id: string;
  isPublic: boolean;
  postedAt: Date | null;
  sourceRank: number;
  companyId: string | null;
  descriptionExcerpt: string | null;
  sources: { boardKey: string | null; externalId: string | null }[];
}

/** Publishes a campaign `Job` to the public job index, deduped across every user's campaigns. */
@singleton()
export class JobListingPublisher {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logos: CompanyLogoService,
  ) {}

  /** A listing is a derived artifact, so a failure here must never fail the agent's job write. */
  publishInBackground(job: ListingSourceJob): void {
    if (this.waiting.length >= MAX_QUEUED) {
      // Recoverable: the next scrape of the same posting publishes it.
      logger.warn({ url: job.url }, "job-listing publish queue full, dropping");
      return;
    }
    void this.publish(job).catch((error) => {
      logger.error({ err: error, url: job.url }, "job-listing publish failed");
    });
  }

  /** A job too thin to publish drafts to null and costs nothing - callers need not pre-filter. */
  async publish(job: ListingSourceJob): Promise<PublishOutcome> {
    return this.publishScoped(job);
  }

  async publishPrivate(job: ListingSourceJob, userId: string): Promise<PublishOutcome> {
    return this.publishScoped(job, userId);
  }

  private async publishScoped(job: ListingSourceJob, userId?: string): Promise<PublishOutcome> {
    const draft = buildListingDraft(job);
    if (!draft) {
      return "skipped";
    }

    const release = await this.acquire();
    try {
      draft.companyLogoUrl = await this.logos
        .resolve({
          companyLogoUrl: draft.companyLogoUrl,
          urls: [job.companyLogoPageUrl, draft.attributionUrl, draft.applyUrl, draft.url],
        })
        .catch(() => null);
      return await this.upsert(draft, true, userId);
    } finally {
      release();
    }
  }

  /** Queues rather than throwing: background work has no caller to tell to back off. */
  private async acquire(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }

  /**
   * The first rule that finds the posting wins: (1) same URL, or same board and board id,
   * (2) same canonical apply link, (3) same company and requisition, (4) a fuzzy match every signal
   * agrees on. Two ids on one board are never one listing, so a rule that would join them is
   * skipped. No interactive transaction: the unique constraints make concurrent writers converge,
   * and the insert that loses the race retries into the merge branch.
   */
  private async upsert(
    draft: ListingDraft,
    retry = true,
    userId?: string,
  ): Promise<PublishOutcome> {
    const now = new Date();
    const {
      board,
      url,
      applyUrl,
      attributionUrl,
      resolutionConfidence,
      postedAt,
      boardKey,
      externalId,
      requisitionId,
      rank,
      ...listing
    } = draft;
    const source = {
      board,
      url,
      applyUrl,
      attributionUrl,
      resolutionConfidence,
      postedAt,
      rank,
      boardKey,
      externalId,
      requisitionId,
      lastSeenAt: now,
      isPublic: !userId,
    };

    try {
      const select = {
        id: true,
        listingId: true,
        rank: true,
        listing: { select: { isPublic: true, postedAt: true, sourceRank: true } },
      } as const;
      // The board id wins over the URL: one posting reached by two URLs is the row holding its id,
      // and giving that id to the URL's row would collide with it.
      const seen =
        (boardKey && externalId
          ? await this.prisma.jobListingSource.findFirst({
              where: { boardKey, externalId },
              select,
            })
          : null) ?? (await this.prisma.jobListingSource.findFirst({ where: { url }, select }));

      if (seen) {
        // A lower-ranked sighting of a known source, such as a list linking to an ATS job, keeps
        // that source's board and attribution.
        const outranked = rank < seen.rank;
        await this.prisma.jobListingSource.update({
          where: { id: seen.id },
          data: {
            lastSeenAt: now,
            applyUrl,
            resolutionConfidence,
            postedAt,
            ...(!outranked && { attributionUrl, rank, ...(board && { board }) }),
            ...(boardKey && externalId && { boardKey, externalId }),
            ...(requisitionId && { requisitionId }),
            ...(!userId && { isPublic: true }),
          },
        });
        await this.prisma.jobListing.update({
          where: { id: seen.listingId },
          data: {
            lastSeenAt: now,
            ...((!userId || !seen.listing.isPublic) &&
              enrich(draft, seen.listing.postedAt, rank >= seen.listing.sourceRank)),
            ...(!userId && { isPublic: true }),
          },
        });
        await this.linkPrivate(userId, seen.listingId);
        await linkListingApplications(this.prisma, seen.listingId, draft.dedupeKey, [
          url,
          applyUrl,
        ]);
        return "refreshed";
      }

      const existing = await this.findMatch(draft);
      // One statement each, so Prisma commits the listing and its source together.
      if (existing) {
        await this.prisma.jobListing.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: now,
            ...((!userId || !existing.isPublic) &&
              enrich(draft, existing.postedAt, rank >= existing.sourceRank)),
            ...(rank > existing.sourceRank && { sourceRank: rank }),
            ...(!existing.companyId && draft.companyId && { companyId: draft.companyId }),
            ...(!userId && { isPublic: true }),
            sources: { create: source },
          },
        });
        await this.linkPrivate(userId, existing.id);
        await linkListingApplications(this.prisma, existing.id, draft.dedupeKey, [url, applyUrl]);
        return "merged";
      }

      const created = await this.prisma.jobListing.create({
        data: {
          ...listing,
          isPublic: !userId,
          postedAt,
          listedAt: postedAt ?? now,
          sourceRank: rank,
          firstSeenAt: now,
          lastSeenAt: now,
          sources: { create: source },
        },
        select: { id: true },
      });
      await this.linkPrivate(userId, created.id);
      await linkListingApplications(this.prisma, created.id, draft.dedupeKey, [url, applyUrl]);
      return "created";
    } catch (error) {
      // Another agent inserted this posting mid-flight; re-running now takes the merge branch.
      if (retry && isPrismaError(error, PRISMA_ERRORS.UNIQUE_VIOLATION)) {
        return this.upsert(draft, false, userId);
      }
      throw error;
    }
  }

  /** Rules 2 to 4: the listing a new source belongs to, or null to create one. */
  private async findMatch(draft: ListingDraft): Promise<MatchedListing | null> {
    const own = [{ boardKey: draft.boardKey, externalId: draft.externalId }];
    const fits = (candidate: MatchedListing) => !boardConflict(own, candidate.sources);
    const apply = draft.applyUrl ? canonicalizeUrl(draft.applyUrl) : null;
    if (apply) {
      const byApply = await this.prisma.jobListing.findMany({
        where: { sources: { some: { OR: [{ url: apply }, { applyUrl: apply }] } } },
        select: MATCH_SELECT,
        take: 5,
      });
      const hit = byApply.find(fits);
      if (hit) return hit;
    }
    if (draft.companyId && draft.requisitionId) {
      const byRequisition = await this.prisma.jobListing.findMany({
        where: {
          companyId: draft.companyId,
          sources: { some: { requisitionId: draft.requisitionId } },
        },
        select: MATCH_SELECT,
        take: 5,
      });
      const hit = byRequisition.find(fits);
      if (hit) return hit;
    }
    if (!draft.companyId) return null;
    const similar = await this.prisma.jobListing.findMany({
      where: { companyId: draft.companyId, matchKey: draft.matchKey },
      select: MATCH_SELECT,
      take: 20,
    });
    const candidate = {
      postedAt: draft.postedAt,
      description: draft.descriptionExcerpt,
      sources: own,
    };
    const matches = similar.filter((listing) =>
      fuzzyMatch(candidate, { ...listing, description: listing.descriptionExcerpt }),
    );
    // Only an unambiguous fuzzy match merges; two candidates means not sure.
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  private async linkPrivate(userId: string | undefined, listingId: string) {
    if (!userId) return;
    await this.prisma.personalJobListing.createMany({
      data: [{ userId, listingId }],
      skipDuplicates: true,
    });
  }
}

/**
 * Fields a newer sighting fills in, only non-empty ones so a thinner scrape never blanks a field.
 * A source ranked below the listing's best contributes only an earlier posting date.
 */
function enrich(draft: ListingDraft, postedAt: Date | null, ranksHighest: boolean) {
  // Sources date the same posting differently; the earliest is closest to when it went live.
  const earlier = draft.postedAt &&
    (!postedAt || draft.postedAt < postedAt) && {
      postedAt: draft.postedAt,
      listedAt: draft.postedAt,
    };
  if (!ranksHighest) return { ...earlier };
  return {
    ...(draft.level !== "unknown" && { level: draft.level }),
    ...(draft.location && { location: draft.location, countries: draft.countries }),
    ...(draft.salary && {
      salary: draft.salary,
      salaryMin: draft.salaryMin,
      salaryMax: draft.salaryMax,
      salaryCurrency: draft.salaryCurrency,
      salaryPeriod: draft.salaryPeriod,
    }),
    ...(draft.employmentType && {
      employmentType: draft.employmentType,
      employmentKind: draft.employmentKind,
    }),
    ...(draft.workMode && { workMode: draft.workMode }),
    ...(draft.companyLogoUrl && { companyLogoUrl: draft.companyLogoUrl }),
    ...earlier,
    ...(draft.descriptionExcerpt && { descriptionExcerpt: draft.descriptionExcerpt }),
    ...(draft.skills.length > 0 && { skills: draft.skills }),
    ...(draft.requirements.length > 0 && { requirements: draft.requirements }),
    ...(draft.responsibilities.length > 0 && { responsibilities: draft.responsibilities }),
    ...(draft.yearsExperience !== null && { yearsExperience: draft.yearsExperience }),
    ...(draft.remote && { remote: true }),
    ...(draft.companyId && { companyId: draft.companyId }),
  };
}
