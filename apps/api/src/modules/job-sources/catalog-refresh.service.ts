import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { PrismaClient } from "@/generated/prisma/client";
import { fetchAts, SITE_PROVIDERS } from "./ats";
import {
  CATALOG_FEED_KEYS,
  type CatalogBoard,
  JOB_FEED_CATALOG,
  PUBLIC_FEED_CATALOG,
} from "./catalog";
import { fetchSourceJson, SourceResponseError } from "./http";
import { JobSourcesService } from "./job-sources.service";
import { type FoundBoard, simplifyBoards } from "./public-feeds-simplify";
import type { FetchJson } from "./types";
import { boardBelongsTo, boardSlugs, PROBE_PROVIDERS, ycHiringCompanies } from "./yc-companies";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Pilots look for listings posted in the last 30 minutes, so boards refresh well inside that.
const BOARD_REFRESH_MS = 10 * 60 * 1000;
const FEED_REFRESH_MS = 30 * 60 * 1000;
// Hundreds of smaller employer boards: a slower cadence keeps request volume polite.
const DISCOVERED_REFRESH_MS = 3 * HOUR;
// A board leaves rotation once no source has vouched for it for this long.
const DISCOVERED_RETENTION_MS = 30 * DAY;
const GONE_RECHECK_MS = 30 * DAY;
// SpaceX and Anduril each list about 2,700 jobs; the adapters' page limits stop at the same 5,000.
const BOARD_MAX_JOBS = 5000;
const BOARD_DISCOVERY_KEY = "discovery/simplify-boards";
const YC_DISCOVERY_KEY = "discovery/yc-boards";
const DISCOVERY_KEYS = [BOARD_DISCOVERY_KEY, YC_DISCOVERY_KEY];
// YC companies are checked a batch at a time, then again once their result is two weeks old.
const YC_BATCH = 100;
const YC_RECHECK_MS = 14 * DAY;

const boardKey = (board: Pick<CatalogBoard, "provider" | "slug">) =>
  `${board.provider}/${board.slug}`;

@singleton()
export class CatalogRefreshService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: JobSourcesService,
  ) {}

  /** Records the employer boards behind Simplify's active roles and schedules them for refresh. */
  async discoverBoards(fetch: FetchJson = fetchSourceJson) {
    return this.recordBoards(await simplifyBoards(fetch));
  }

  /**
   * Checks the next batch of hiring YC companies for a public Ashby, Greenhouse, Lever or Workable
   * board, by guessing its slug and keeping only boards whose postings name the company.
   */
  async discoverYcBoards(fetch: FetchJson = fetchSourceJson, batch = YC_BATCH) {
    const companies = await ycHiringCompanies(fetch);
    const probes = await this.prisma.jobBoardProbe.findMany({
      where: { key: { in: companies.map((company) => `yc/${company.slug}`) } },
      select: { key: true, checkedAt: true },
    });
    const checked = new Map(probes.map((probe) => [probe.key, probe.checkedAt.getTime()]));
    const stale = Date.now() - YC_RECHECK_MS;
    const next = companies
      .filter((company) => (checked.get(`yc/${company.slug}`) ?? 0) < stale)
      .sort((a, b) => (checked.get(`yc/${a.slug}`) ?? 0) - (checked.get(`yc/${b.slug}`) ?? 0))
      .slice(0, batch);
    const found: FoundBoard[] = [];
    for (const company of next) {
      let board: FoundBoard | null = null;
      for (const provider of PROBE_PROVIDERS) {
        for (const slug of boardSlugs(company)) {
          // A missing board is an HTTP 404, which is the common case and not a failure.
          const jobs = await fetchAts(fetch, provider, slug, company.name, { detailBudget: 0 })
            .then((board) => board.jobs)
            .catch(() => []);
          const postings = jobs.slice(0, 10).map(
            (job) => `${job.title}
${job.description}`,
          );
          if (jobs.length && boardBelongsTo(company, postings)) {
            board = { provider, slug, company: company.name };
            break;
          }
        }
        if (board) break;
      }
      if (board) found.push(board);
      const key = `yc/${company.slug}`;
      const result = { checkedAt: new Date(), boardKey: board ? boardKey(board) : null };
      await this.prisma.jobBoardProbe.upsert({
        where: { key },
        create: { key, ...result },
        update: result,
      });
    }
    await this.recordBoards(found);
    return { checked: next.length, found: found.length };
  }

  private async recordBoards(boards: FoundBoard[]) {
    const catalog = new Set(JOB_FEED_CATALOG.map((board) => boardKey(board).toLowerCase()));
    const found = boards.filter((board) => !catalog.has(boardKey(board).toLowerCase()));
    const now = new Date();
    for (const board of found) {
      const key = boardKey(board);
      await this.prisma.discoveredJobBoard.upsert({
        where: { key },
        create: { key, ...board, firstSeenAt: now, lastSeenAt: now },
        update: { company: board.company, lastSeenAt: now },
      });
    }
    await this.prisma.jobFeedRefresh.createMany({
      data: found.map((board) => ({ key: boardKey(board) })),
      skipDuplicates: true,
    });
    return found.length;
  }

  async refreshDue() {
    await this.prisma.jobFeedRefresh.createMany({
      data: [...CATALOG_FEED_KEYS, ...DISCOVERY_KEYS].map((key) => ({ key })),
      skipDuplicates: true,
    });
    const discovered = await this.prisma.discoveredJobBoard.findMany({
      where: {
        lastSeenAt: { gte: new Date(Date.now() - DISCOVERED_RETENTION_MS) },
        OR: [{ goneAt: null }, { goneAt: { lt: new Date(Date.now() - GONE_RECHECK_MS) } }],
      },
      select: { key: true, provider: true, slug: true, company: true },
    });
    const discoveredByKey = new Map(discovered.map((board) => [board.key, board]));
    const due = await this.prisma.jobFeedRefresh.findMany({
      where: {
        key: { in: [...CATALOG_FEED_KEYS, ...DISCOVERY_KEYS, ...discoveredByKey.keys()] },
        nextRefreshAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      select: { key: true },
      orderBy: { nextRefreshAt: "asc" },
    });
    const counts = { refreshed: 0, failed: 0, skipped: 0, imported: 0 };
    const pending = [...due];
    const worker = async () => {
      for (;;) {
        const row = pending.shift();
        if (!row) return;
        const catalogBoard = JOB_FEED_CATALOG.find((entry) => boardKey(entry) === row.key);
        const board = catalogBoard ?? discoveredByKey.get(row.key);
        const feed = PUBLIC_FEED_CATALOG.find((entry) => `public/${entry.id}` === row.key);
        const discovery = DISCOVERY_KEYS.includes(row.key);
        if (!board && !feed && !discovery) continue;
        const now = new Date();
        const leaseToken = crypto.randomUUID();
        const claim = await this.prisma.jobFeedRefresh.updateMany({
          where: {
            key: row.key,
            nextRefreshAt: { lte: now },
            OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
          },
          data: { leaseToken, leaseUntil: new Date(now.getTime() + HOUR) },
        });
        if (!claim.count) {
          counts.skipped++;
          continue;
        }
        let interval = FEED_REFRESH_MS;
        if (board) interval = catalogBoard ? BOARD_REFRESH_MS : DISCOVERED_REFRESH_MS;
        if (catalogBoard && SITE_PROVIDERS.includes(catalogBoard.provider))
          interval = DISCOVERED_REFRESH_MS;
        if (row.key === BOARD_DISCOVERY_KEY) interval = DAY;
        if (row.key === YC_DISCOVERY_KEY) interval = FEED_REFRESH_MS;
        try {
          let result = { fetched: 0, imported: 0, truncated: false };
          if (row.key === BOARD_DISCOVERY_KEY) {
            const boards = await this.discoverBoards();
            result = { fetched: boards, imported: 0, truncated: false };
          } else if (row.key === YC_DISCOVERY_KEY) {
            const { checked, found } = await this.discoverYcBoards();
            result = { fetched: checked, imported: found, truncated: false };
          } else if (board)
            result = await this.sources.publicBoard(
              board.provider,
              board.slug,
              undefined,
              board.company,
              BOARD_MAX_JOBS,
            );
          else result = await this.sources.publicFeed(feed!.id);
          await this.prisma.jobFeedRefresh.updateMany({
            where: { key: row.key, leaseToken },
            data: {
              leaseToken: null,
              leaseUntil: null,
              lastSuccessAt: new Date(),
              nextRefreshAt: new Date(Date.now() + interval),
              lastError: null,
              fetched: result.fetched,
              imported: result.imported,
              truncated: result.truncated,
            },
          });
          if (board && !catalogBoard)
            await this.prisma.discoveredJobBoard.updateMany({
              where: { key: row.key, goneAt: { not: null } },
              data: { goneAt: null },
            });
          counts.refreshed++;
          counts.imported += result.imported;
          logger.info({ source: row.key, ...result }, "Job feed refreshed");
        } catch (error) {
          // A discovered board whose API says 404 no longer exists; stop refreshing it.
          if (
            board &&
            !catalogBoard &&
            error instanceof SourceResponseError &&
            error.upstreamStatus === 404
          )
            await this.prisma.discoveredJobBoard.update({
              where: { key: row.key },
              data: { goneAt: new Date() },
            });
          const retryAfter = error instanceof SourceResponseError ? error.retryAfterMs : 0;
          await this.prisma.jobFeedRefresh.updateMany({
            where: { key: row.key, leaseToken },
            data: {
              leaseToken: null,
              leaseUntil: null,
              // A board that fails waits a full cycle so a dead slug does not retry every hour.
              nextRefreshAt: new Date(Date.now() + Math.max(HOUR, interval, retryAfter)),
              lastError: (error instanceof Error ? error.message : "Feed refresh failed").slice(
                0,
                500,
              ),
            },
          });
          counts.failed++;
          logger.warn({ source: row.key, err: error }, "Job feed refresh failed");
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return counts;
  }
}
