import type {
  AdminJobListingQuery,
  JobListingQuery,
  JobListingStatus,
} from "@openapply/contracts/job-listing";
import { type PaginationQuery, pageSlice, paginate } from "@openapply/contracts/pagination";
import { workspaceChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { forbidden, isPrismaError, notFound, PRISMA_ERRORS, unprocessable } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { publish } from "@/common/sse";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { listingApplicationIdentity } from "./listing-applications";
import { listingFilters, listingOrder } from "./listing-filters";
import { listingVisibility, sourceVisibility } from "./listing-visibility";
import {
  groupSkillFacets,
  resolveSkillFilter,
  type SkillCountRow,
  type SkillVocabulary,
} from "./skill-facets";

/** Selected explicitly, not spread: a user column added to the table later must not leak out here. */
const SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  level: true,
  yearsExperience: true,
  company: true,
  location: true,
  countries: true,
  remote: true,
  workMode: true,
  salary: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  employmentKind: true,
  companyLogoUrl: true,
  postedAt: true,
  listedAt: true,
  employmentType: true,
  skills: true,
  descriptionExcerpt: true,
  firstSeenAt: true,
  lastSeenAt: true,
  // The list only shows "posted on N boards", so count them rather than shipping every source row.
  _count: { select: { sources: { where: sourceVisibility() } } },
  sources: {
    where: sourceVisibility(),
    select: { applyUrl: true, attributionUrl: true, board: true, url: true },
    orderBy: { lastSeenAt: "desc" },
  },
} satisfies Prisma.JobListingSelect;

/** The detail page is the only view that needs the board links and the long-form digest fields. */
const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  requirements: true,
  responsibilities: true,
  yearsExperience: true,
  sources: {
    where: sourceVisibility(),
    select: {
      board: true,
      url: true,
      lastSeenAt: true,
      applyUrl: true,
      attributionUrl: true,
      resolutionConfidence: true,
      postedAt: true,
    },
    orderBy: { lastSeenAt: "desc" },
  },
} satisfies Prisma.JobListingSelect;

function userSummarySelect(userId: string) {
  const where = sourceVisibility(userId);
  return {
    ...SUMMARY_SELECT,
    _count: { select: { sources: { where } } },
    sources: { ...SUMMARY_SELECT.sources, where },
  } satisfies Prisma.JobListingSelect;
}

function userDetailSelect(userId: string) {
  const where = sourceVisibility(userId);
  return {
    ...DETAIL_SELECT,
    _count: { select: { sources: { where } } },
    sources: { ...DETAIL_SELECT.sources, where },
  } satisfies Prisma.JobListingSelect;
}

const ADMIN_SELECT = {
  ...SUMMARY_SELECT,
  status: true,
  createdAt: true,
} satisfies Prisma.JobListingSelect;

type CountedRow = {
  _count: { sources: number };
  sources: {
    applyUrl: string | null;
    attributionUrl?: string | null;
    board: string | null;
    url: string;
  }[];
};

/** Flatten Prisma's `_count` into the flat `sourceCount` the contract exposes. */
function withSourceCount<T extends CountedRow>({ _count, ...row }: T) {
  return {
    ...row,
    sourceCount: _count.sources,
    canApply: row.sources.some((s) => allowedApplyUrl(s.applyUrl)),
    foundOn: [...new Set(row.sources.map((s) => s.board ?? "source"))],
    employerUrl:
      row.sources.map((source) => allowedApplyUrl(source.applyUrl)).find(Boolean) ?? null,
    sourceUrl: row.sources[0]?.url ?? null,
    attributionLinks: row.sources.map((source) => ({
      board: source.board,
      url: source.attributionUrl ?? source.url,
    })),
  };
}

const SITEMAP_LIMIT = 5000;

/** Enough to cover the long tail a user would plausibly filter by, short enough to ship to a phone. */
const FACET_LIMIT = 40;
const FACET_TTL_MS = 10 * 60_000;

const APPLICATION_SELECT = {
  id: true,
  appliedAt: true,
  source: true,
  status: true,
  campaignId: true,
  submissionAttempt: { select: { id: true } },
} satisfies Prisma.ApplicationSelect;
type AppliedStateRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

function applicationState(applications: AppliedStateRow[]) {
  const application = applications[0];
  return {
    isApplied: Boolean(application),
    applicationId: application?.id ?? null,
    appliedAt: application?.appliedAt ?? null,
    canUndoApplied:
      application?.source === "manual" &&
      application.status === "applied" &&
      application.campaignId === null &&
      application.submissionAttempt === null,
  };
}

function userApplications(userId: string) {
  return {
    where: { userId },
    select: APPLICATION_SELECT,
    orderBy: { appliedAt: "desc" as const },
    take: 1,
  };
}

@singleton()
export class JobListingService {
  /** The in-flight promise, not the resolved value: N concurrent misses must share one scan. */
  private vocabulary: { expiresAt: number; value: Promise<SkillVocabulary> } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  /** Public list. Always scoped to published rows - hidden ones exist only for admins. */
  async list(query: JobListingQuery) {
    const { total, rows } = await this.query({ ...query, status: "published" }, SUMMARY_SELECT);
    return paginate(rows.map(withSourceCount), query, total);
  }

  async listForUser(userId: string, query: JobListingQuery) {
    const indexedBefore = query.indexedBefore ? new Date(query.indexedBefore) : new Date();
    const { total, rows } = await this.query(
      { ...query, indexedBefore: indexedBefore.toISOString(), status: "published" },
      {
        ...userSummarySelect(userId),
        savedBy: { where: { userId }, select: { savedAt: true } },
        applications: userApplications(userId),
      },
      userId,
    );
    return {
      ...paginate(
        rows.map(({ savedBy, applications, ...row }) => ({
          ...withSourceCount(row),
          isSaved: savedBy.length > 0,
          ...applicationState(applications),
        })),
        query,
        total,
      ),
      indexedTotal: await this.prisma.jobListing.count({
        where: { status: "published", ...listingVisibility(userId) },
      }),
      indexedBefore,
    };
  }

  async saved(userId: string, query: JobListingQuery) {
    const indexedBefore = query.indexedBefore ? new Date(query.indexedBefore) : new Date();
    const where = {
      userId,
      listing: await this.where(
        { ...query, indexedBefore: indexedBefore.toISOString(), status: "published" },
        userId,
      ),
    };
    const [rows, total] = await Promise.all([
      this.prisma.savedJobListing.findMany({
        where,
        select: {
          savedAt: true,
          listing: {
            select: { ...userSummarySelect(userId), applications: userApplications(userId) },
          },
        },
        orderBy: listingOrder(query.sort).map((listing) => ({ listing })),
        ...pageSlice(query),
      }),
      this.prisma.savedJobListing.count({ where }),
    ]);
    return {
      ...paginate(
        rows.map(({ listing: { applications, ...listing }, savedAt }) => ({
          ...withSourceCount(listing),
          ...applicationState(applications),
          isSaved: true as const,
          savedAt,
        })),
        query,
        total,
      ),
      indexedTotal: await this.prisma.jobListing.count({
        where: { status: "published", ...listingVisibility(userId) },
      }),
      indexedBefore,
    };
  }

  async updates(userId: string, query: JobListingQuery & { indexedBefore: string }) {
    const asOf = new Date();
    const where = await this.where(
      { ...query, indexedBefore: undefined, status: "published" },
      userId,
    );
    const newCount = await this.prisma.jobListing.count({
      where: {
        AND: [where, { firstSeenAt: { gt: new Date(query.indexedBefore), lte: asOf } }],
      },
    });
    return { newCount, asOf };
  }

  async savedCount(userId: string) {
    return {
      count: await this.prisma.savedJobListing.count({
        where: { userId, listing: { status: "published", ...listingVisibility(userId) } },
      }),
    };
  }

  async savedSlugs(userId: string, query: PaginationQuery) {
    const where = {
      status: "published" as const,
      savedBy: { some: { userId } },
      applications: { none: { userId } },
      ...listingVisibility(userId),
    };
    const [items, total] = await Promise.all([
      this.prisma.jobListing.findMany({
        where,
        select: { slug: true },
        orderBy: { slug: "asc" },
        ...pageSlice(query),
      }),
      this.prisma.jobListing.count({ where }),
    ]);
    return paginate(items, query, total);
  }

  async setSaved(userId: string, slug: string, isSaved: boolean) {
    const listing = await this.prisma.jobListing.findFirst({
      where: {
        slug,
        ...listingVisibility(userId),
        ...(isSaved && { status: "published" as const }),
      },
      select: { id: true },
    });
    if (!listing) throw notFound("Job listing not found");
    if (isSaved) {
      await this.prisma.savedJobListing.createMany({
        data: [{ userId, listingId: listing.id }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.savedJobListing.deleteMany({ where: { userId, listingId: listing.id } });
    }
    return { slug, isSaved, savedCount: (await this.savedCount(userId)).count };
  }

  async bySlugForUser(userId: string, slug: string) {
    const row = await this.prisma.jobListing.findFirst({
      where: { slug, status: "published", ...listingVisibility(userId) },
      select: userDetailSelect(userId),
    });
    if (!row) throw notFound("Job listing not found");
    const listing = withSourceCount(row);
    const saved = await this.prisma.savedJobListing.findUnique({
      where: { userId_listingId: { userId, listingId: listing.id } },
      select: { savedAt: true },
    });
    const applications = await this.prisma.application.findMany({
      where: { userId, listingId: listing.id },
      select: APPLICATION_SELECT,
      orderBy: { appliedAt: "desc" },
      take: 1,
    });
    return { ...listing, isSaved: saved !== null, ...applicationState(applications) };
  }

  async markApplied(userId: string, slug: string, authKind: AuthKind) {
    if (authKind !== "session_user")
      throw forbidden(
        "Mark as applied is a manual action in Discover. Agents must record a confirmed submission receipt.",
      );
    const listing = await this.bySlugForUser(userId, slug);
    if (listing.isApplied)
      return {
        slug,
        isApplied: true,
        appliedAt: listing.appliedAt,
        applicationId: listing.applicationId,
        canUndoApplied: listing.canUndoApplied,
      };
    const source =
      listing.sources.find((item) => allowedApplyUrl(item.applyUrl)) ?? listing.sources[0];
    const rawUrl = source?.applyUrl ?? source?.url;
    if (!rawUrl) throw unprocessable("This listing has no source URL to record an application.");
    const url = canonicalizeJobUrl(rawUrl);
    const application = await this.prisma.application
      .upsert({
        where: { userId_url: { userId, url } },
        create: {
          userId,
          url,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          board: source?.board,
          source: "manual",
          listingId: listing.id,
          ...listingApplicationIdentity({ ...listing, url }),
          events: { create: { kind: "status_change", toStatus: "applied", source: "manual" } },
        },
        // An existing agent receipt or application status must never be overwritten by a manual mark.
        update: { listingId: listing.id },
        select: APPLICATION_SELECT,
      })
      .catch(async (error: unknown) => {
        // Nested event creation may race before Prisma's upsert insert; the winner owns the record.
        if (!isPrismaError(error, PRISMA_ERRORS.UNIQUE_VIOLATION)) throw error;
        return this.prisma.application.update({
          where: { userId_url: { userId, url } },
          data: { listingId: listing.id },
          select: APPLICATION_SELECT,
        });
      });
    publish(workspaceChannel, { userId }, { type: "application.updated", id: application.id });
    return { slug, ...applicationState([application]) };
  }

  async undoApplied(userId: string, slug: string, authKind: AuthKind) {
    if (authKind !== "session_user")
      throw forbidden("Only a signed-in person can undo a manual applied mark.");
    const listing = await this.bySlugForUser(userId, slug);
    const removed = await this.prisma.application.deleteMany({
      where: {
        userId,
        id: listing.applicationId ?? "",
        listingId: listing.id,
        source: "manual",
        status: "applied",
        campaignId: null,
        submission: { equals: Prisma.DbNull },
        submissionAttempt: { is: null },
      },
    });
    if (removed.count && listing.applicationId)
      publish(
        workspaceChannel,
        { userId },
        { type: "application.updated", id: listing.applicationId },
      );
    const updated = await this.bySlugForUser(userId, slug);
    return {
      slug,
      isApplied: updated.isApplied,
      appliedAt: updated.appliedAt,
      applicationId: updated.applicationId,
      canUndoApplied: updated.canUndoApplied,
    };
  }

  /** Moderation list. The only caller that may see hidden rows. */
  async listForAdmin(query: AdminJobListingQuery) {
    const { total, rows } = await this.query(query, ADMIN_SELECT);
    return paginate(rows.map(withSourceCount), query, total);
  }

  /** The skill option list behind the `?tech=` filter, most common first. */
  async facets() {
    const { facets } = await this.skillVocabulary();
    return { skills: facets.slice(0, FACET_LIMIT) };
  }

  /**
   * Every skill in the index, grouped by casing. Cached: it backs both the option list and the
   * `?tech=` lookup, so it is read on every filtered request but changes only as jobs are ingested.
   */
  private skillVocabulary(): Promise<SkillVocabulary> {
    const now = Date.now();
    if (this.vocabulary && this.vocabulary.expiresAt > now) {
      return this.vocabulary.value;
    }

    const value = this.loadVocabulary();
    this.vocabulary = { expiresAt: now + FACET_TTL_MS, value };
    // A failed scan must not be cached for ten minutes.
    value.catch(() => {
      this.vocabulary = null;
    });
    return value;
  }

  private async loadVocabulary(): Promise<SkillVocabulary> {
    // Every row, not just published: `where()` also serves the admin list, so a hidden listing's
    // casing has to resolve too. The counts stay published-only, so the public facet list - which
    // drops zero-count entries - can never leak a skill that exists solely on a hidden listing.
    // `::int` because a bare count() comes back as a BigInt, which does not survive JSON.
    const rows = await this.prisma.$queryRaw<SkillCountRow[]>`
      SELECT skill, count(*) FILTER (WHERE status = 'published'::job_listing_status)::int AS count
      FROM (SELECT unnest(skills) AS skill, status FROM job_listings WHERE is_public = true) entries
      GROUP BY 1
      ORDER BY 2 DESC
    `;
    return groupSkillFacets(rows);
  }

  private async query<T extends Prisma.JobListingSelect>(
    query: AdminJobListingQuery,
    select: T,
    userId?: string,
  ) {
    const where = await this.where(query, userId);

    const [rows, total] = await Promise.all([
      this.prisma.jobListing.findMany({
        where,
        orderBy: listingOrder(query.sort),
        ...pageSlice(query),
        select,
      }),
      this.prisma.jobListing.count({ where }),
    ]);

    return { total, rows };
  }

  private async where(
    query: AdminJobListingQuery,
    userId?: string,
  ): Promise<Prisma.JobListingWhereInput> {
    const { tech } = query;
    // `hasSome` is exact, so the request is expanded into the casings actually stored.
    const skills = tech?.length
      ? resolveSkillFilter(tech, (await this.skillVocabulary()).variants)
      : [];

    return { ...listingFilters(query, skills, userId), ...listingVisibility(userId) };
  }

  async bySlug(slug: string) {
    const listing = await this.prisma.jobListing.findFirst({
      where: { slug, status: "published", isPublic: true },
      select: DETAIL_SELECT,
    });
    if (!listing) {
      throw notFound("Job listing not found");
    }
    return withSourceCount(listing);
  }

  /** Slug + freshness for the web's sitemap. Capped - a sitemap file maxes out at 50k URLs. */
  async sitemap() {
    return this.prisma.jobListing.findMany({
      where: { status: "published", isPublic: true },
      orderBy: { lastSeenAt: "desc" },
      take: SITEMAP_LIMIT,
      select: { slug: true, lastSeenAt: true },
    });
  }

  // No existence pre-check: the error middleware maps Prisma's P2025 to a 404 already.
  async setStatus(id: string, status: JobListingStatus) {
    const updated = await this.prisma.jobListing.update({
      where: { id },
      data: { status },
      select: ADMIN_SELECT,
    });
    return withSourceCount(updated);
  }

  /** Sources cascade with the listing. */
  async remove(id: string) {
    await this.prisma.jobListing.delete({ where: { id } });
    return { deleted: id };
  }
}
