import { singleton } from "tsyringe";
import { isPrismaError, PRISMA_ERRORS } from "@/common/errors";
import { logger } from "@/common/logger";
import { PrismaClient } from "@/generated/prisma/client";
import { CompanyLogoService } from "./company-logo.service";
import { canonicalizeUrl } from "./dedupe";
import { linkListingApplications } from "./listing-applications";
import { buildListingDraft, type ListingDraft, type ListingSourceJob } from "./listing-draft";

/** What a publish did. The seed reports on these; the write-through callers ignore them. */
export type PublishOutcome = "created" | "merged" | "refreshed" | "skipped";

/** Publishing is fire-and-forget, so nothing throttles it - without a ceiling a burst of job writes
 *  would let background work monopolize the pool and stall the request handlers sharing it. */
const MAX_CONCURRENT = 4;

/** Past this the producer is hopelessly ahead; drop rather than grow the queue without bound. */
const MAX_QUEUED = 500;

/** Community lists that point at employer boards; the employer board keeps the attribution. */
const CURATED_LISTS = new Set([
  "simplify-new-grad",
  "simplify-internships",
  "canadian-internships",
]);

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
   * Identity is URL-first, then dedupe key: a known url is the stronger signal, and going by the key
   * first would fork an orphan listing whenever a re-scrape reworded the title.
   *
   * No interactive transaction: at READ COMMITTED it never made the read-then-write atomic anyway,
   * and it held a pooled connection across every round-trip. The unique constraints are what make
   * concurrent agents converge - so let them, and retry the insert that loses the race.
   */
  private async upsert(
    draft: ListingDraft,
    retry = true,
    userId?: string,
  ): Promise<PublishOutcome> {
    const now = new Date();
    const { board, url, applyUrl, attributionUrl, resolutionConfidence, postedAt, ...listing } =
      draft;
    const source = {
      board,
      url,
      applyUrl,
      attributionUrl,
      resolutionConfidence,
      postedAt,
      lastSeenAt: now,
      isPublic: !userId,
    };

    try {
      const seen = await this.prisma.jobListingSource.findUnique({
        where: { url },
        select: {
          listingId: true,
          board: true,
          listing: { select: { isPublic: true, postedAt: true } },
        },
      });

      if (seen) {
        const preserveAttribution =
          !!board && CURATED_LISTS.has(board) && seen.board && seen.board !== board;
        await this.prisma.jobListingSource.update({
          where: { url },
          data: {
            lastSeenAt: now,
            applyUrl,
            ...(!preserveAttribution && { attributionUrl }),
            resolutionConfidence,
            postedAt,
            ...(board && !preserveAttribution && { board }),
            ...(!userId && { isPublic: true }),
          },
        });
        await this.prisma.jobListing.update({
          where: { id: seen.listingId },
          data: {
            lastSeenAt: now,
            ...((!userId || !seen.listing.isPublic) && enrich(draft, seen.listing.postedAt)),
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

      const resolved =
        userId && applyUrl
          ? await this.prisma.jobListingSource.findFirst({
              where: {
                OR: [{ url: canonicalizeUrl(applyUrl) }, { applyUrl: canonicalizeUrl(applyUrl) }],
              },
              select: { listingId: true, listing: { select: { isPublic: true, postedAt: true } } },
            })
          : null;
      const existing = resolved
        ? {
            id: resolved.listingId,
            isPublic: resolved.listing.isPublic,
            postedAt: resolved.listing.postedAt,
          }
        : await this.prisma.jobListing.findUnique({
            where: { dedupeKey: draft.dedupeKey },
            select: { id: true, isPublic: true, postedAt: true },
          });

      // One statement each, so Prisma commits the listing and its source together.
      if (existing) {
        await this.prisma.jobListing.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: now,
            ...((!userId || !existing.isPublic) && enrich(draft, existing.postedAt)),
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

  private async linkPrivate(userId: string | undefined, listingId: string) {
    if (!userId) return;
    await this.prisma.personalJobListing.createMany({
      data: [{ userId, listingId }],
      skipDuplicates: true,
    });
  }
}

/** Only non-empty values, so a later thinner scrape can enrich a listing but never blank it out. */
/** Fields a newer sighting can fill in; `postedAt` is the listing's current posting date. */
function enrich(draft: ListingDraft, postedAt: Date | null) {
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
    // Sources date the same posting differently; the earliest is closest to when it went live.
    ...(draft.postedAt &&
      (!postedAt || draft.postedAt < postedAt) && {
        postedAt: draft.postedAt,
        listedAt: draft.postedAt,
      }),
    ...(draft.descriptionExcerpt && { descriptionExcerpt: draft.descriptionExcerpt }),
    ...(draft.skills.length > 0 && { skills: draft.skills }),
    ...(draft.requirements.length > 0 && { requirements: draft.requirements }),
    ...(draft.responsibilities.length > 0 && { responsibilities: draft.responsibilities }),
    ...(draft.yearsExperience !== null && { yearsExperience: draft.yearsExperience }),
    ...(draft.remote && { remote: true }),
  };
}
