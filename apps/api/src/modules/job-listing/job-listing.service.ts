import type {
  AdminJobListingQuery,
  JobListingQuery,
  JobListingStatus,
} from "@openapply/contracts/job-listing";
import { pageSlice, paginate } from "@openapply/contracts/pagination";
import { singleton } from "tsyringe";
import { notFound } from "@/common/errors";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
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
  remote: true,
  salary: true,
  employmentType: true,
  skills: true,
  descriptionExcerpt: true,
  firstSeenAt: true,
  lastSeenAt: true,
  // The list only shows "posted on N boards", so count them rather than shipping every source row.
  _count: { select: { sources: true } },
  sources: { select: { applyUrl: true, board: true } },
} satisfies Prisma.JobListingSelect;

/** The detail page is the only view that needs the board links and the long-form digest fields. */
const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  requirements: true,
  responsibilities: true,
  yearsExperience: true,
  sources: {
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

const ADMIN_SELECT = {
  ...SUMMARY_SELECT,
  status: true,
  createdAt: true,
} satisfies Prisma.JobListingSelect;

type CountedRow = {
  _count: { sources: number };
  sources: { applyUrl: string | null; board: string | null }[];
};

/** Flatten Prisma's `_count` into the flat `sourceCount` the contract exposes. */
function withSourceCount<T extends CountedRow>({ _count, ...row }: T) {
  return {
    ...row,
    sourceCount: _count.sources,
    canApply: row.sources.some((s) => allowedApplyUrl(s.applyUrl)),
    foundOn: [...new Set(row.sources.map((s) => s.board ?? "source"))],
  };
}

const SITEMAP_LIMIT = 5000;

/** Enough to cover the long tail a user would plausibly filter by, short enough to ship to a phone. */
const FACET_LIMIT = 40;
const FACET_TTL_MS = 10 * 60_000;

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
      FROM (SELECT unnest(skills) AS skill, status FROM job_listings) entries
      GROUP BY 1
      ORDER BY 2 DESC
    `;
    return groupSkillFacets(rows);
  }

  private async query<T extends Prisma.JobListingSelect>(query: AdminJobListingQuery, select: T) {
    const where = await this.where(query);

    const [rows, total] = await Promise.all([
      this.prisma.jobListing.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        ...pageSlice(query),
        select,
      }),
      this.prisma.jobListing.count({ where }),
    ]);

    return { total, rows };
  }

  private async where(query: AdminJobListingQuery): Promise<Prisma.JobListingWhereInput> {
    const { q, location, remote, board, tech, status, level, maxYears } = query;
    // `hasSome` is exact, so the request is expanded into the casings actually stored.
    const skills = tech?.length
      ? resolveSkillFilter(tech, (await this.skillVocabulary()).variants)
      : [];

    return {
      ...(level && { level }),
      ...(maxYears !== undefined && { yearsExperience: { lte: maxYears } }),
      ...(status && { status }),
      ...(remote !== undefined && { remote }),
      ...(location && { location: { contains: location, mode: "insensitive" } }),
      ...(skills.length > 0 && { skills: { hasSome: skills } }),
      // `board` is stored lowercase, so this is an indexed equality, not an ILIKE scan.
      ...(board && { sources: { some: { board: board.toLowerCase() } } }),
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { company: { contains: q, mode: "insensitive" } },
        ],
      }),
    };
  }

  async bySlug(slug: string) {
    const listing = await this.prisma.jobListing.findFirst({
      where: { slug, status: "published" },
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
      where: { status: "published" },
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
