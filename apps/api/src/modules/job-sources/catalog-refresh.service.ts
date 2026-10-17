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
import { boardCompanyName, checkBoard, commonCrawlBoards, type RangeReader } from "./common-crawl";
import { fetchSourceJson, fetchSourceRange, fetchSourceText, SourceResponseError } from "./http";
import { JobSourcesService } from "./job-sources.service";
import { canadianBoards } from "./public-feeds-canada";
import { type FoundBoard, simplifyBoards } from "./public-feeds-simplify";
import type { FetchText } from "./public-feeds-wwr";
import type { FetchJson } from "./types";
import { workdayJobCount } from "./workday";
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
const CC_SCAN_KEY = "discovery/common-crawl";
const CC_CHECK_KEY = "discovery/common-crawl-check";
const DISCOVERY_KEYS = [BOARD_DISCOVERY_KEY, YC_DISCOVERY_KEY, CC_SCAN_KEY, CC_CHECK_KEY];
// Common Crawl publishes about one crawl a month; each found board waits as a pending probe.
const CC_SCAN_MS = 30 * DAY;
const CC_CHECK_BATCH = 300;
const PENDING = new Date(0);
// Two of these may be on Workday boards at once; see runDue.
const WORKERS = 4;
// YC companies are checked a batch at a time, then again once their result is two weeks old.
const YC_BATCH = 100;
const YC_RECHECK_MS = 14 * DAY;

const boardKey = (board: Pick<CatalogBoard, "provider" | "slug">) =>
  `${board.provider}/${board.slug}`;

@singleton()
export class CatalogRefreshService {
  private running: ReturnType<CatalogRefreshService["runDue"]> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: JobSourcesService,
  ) {}

  /**
   * Records the employer boards behind the Simplify and Canadian lists' roles and schedules them
   * for refresh. A Workday board is kept only after one request shows it answers and lists jobs.
   */
  async discoverBoards(fetch: FetchJson = fetchSourceJson, fetchText: FetchText = fetchSourceText) {
    const boards = [...(await simplifyBoards(fetch)), ...(await canadianBoards(fetchText))];
    const known = new Set(
      (await this.prisma.discoveredJobBoard.findMany({ select: { key: true } })).map((board) =>
        board.key.toLowerCase(),
      ),
    );
    const checked: FoundBoard[] = [];
    for (const board of boards) {
      if (board.provider !== "workday" || known.has(boardKey(board).toLowerCase())) {
        checked.push(board);
        continue;
      }
      if (await this.workdayListsJobs(fetch, board)) checked.push(board);
    }
    return this.recordBoards(checked);
  }

  /** Queues every board in the newest crawl that OpenApply has not seen, as a pending probe. */
  async scanCommonCrawl(
    read: RangeReader = fetchSourceRange,
    fetchText: FetchText = fetchSourceText,
  ) {
    const { crawl, boards, rowGroups } = await commonCrawlBoards(read, fetchText);
    const catalog = new Set(JOB_FEED_CATALOG.map((board) => boardKey(board).toLowerCase()));
    const known = new Set(
      (await this.prisma.discoveredJobBoard.findMany({ select: { key: true } })).map((board) =>
        board.key.toLowerCase(),
      ),
    );
    const fresh = boards.filter((board) => {
      const key = boardKey(board).toLowerCase();
      return !catalog.has(key) && !known.has(key);
    });
    const { count } = await this.prisma.jobBoardProbe.createMany({
      data: fresh.map((board) => ({ key: `cc/${boardKey(board)}`, checkedAt: PENDING })),
      skipDuplicates: true,
    });
    logger.info(
      { crawl, rowGroups, found: byProvider(boards), queued: count, new: byProvider(fresh) },
      "Common Crawl scanned",
    );
    return { found: boards.length, queued: count };
  }

  /** Checks a batch of queued Common Crawl boards with one request each, providers in parallel. */
  async checkCommonCrawl(
    fetch: FetchJson = fetchSourceJson,
    batch = CC_CHECK_BATCH,
    fetchText: FetchText = fetchSourceText,
  ) {
    const pending = await this.prisma.jobBoardProbe.findMany({
      where: { key: { startsWith: "cc/" }, checkedAt: PENDING },
      select: { key: true },
      take: batch,
    });
    // One lane per API host; Workday boards sit on separate tenant hosts, so they get eight lanes.
    const groups = new Map<string, FoundBoard[]>();
    pending.forEach(({ key }, index) => {
      const [provider, ...slug] = key.slice(3).split("/");
      const board = { provider, slug: slug.join("/"), company: "" } as FoundBoard;
      const lane = board.provider === "workday" ? `workday/${index % 8}` : board.provider;
      groups.set(lane, [...(groups.get(lane) ?? []), board]);
    });
    const kept: FoundBoard[] = [];
    await Promise.all(
      [...groups.values()].map(async (boards) => {
        for (const board of boards) {
          // A board that fails, or robots.txt disallows, is checked and not kept.
          const found = await checkBoard(fetch, board).catch(() => null);
          // Ashby and Lever APIs carry no company name; the board page's title does.
          const name = found ? await boardCompanyName(fetchText, found).catch(() => null) : null;
          if (found && name) found.company = name;
          // Recorded at once, so a stopped run never leaves a kept probe without its board.
          if (found) {
            kept.push(found);
            await this.recordBoards([found]);
          }
          await this.prisma.jobBoardProbe.update({
            where: { key: `cc/${boardKey(board)}` },
            data: { checkedAt: new Date(), boardKey: found ? boardKey(found) : null },
          });
        }
      }),
    );
    logger.info({ checked: pending.length, kept: byProvider(kept) }, "Common Crawl boards checked");
    return { checked: pending.length, kept: kept.length };
  }

  /** One probe per new Workday board, remembered for two weeks so daily discovery stays cheap. */
  private async workdayListsJobs(fetch: FetchJson, board: FoundBoard) {
    const key = `probe/${boardKey(board).toLowerCase()}`;
    const probe = await this.prisma.jobBoardProbe.findUnique({ where: { key } });
    if (probe && probe.checkedAt.getTime() > Date.now() - YC_RECHECK_MS) return !!probe.boardKey;
    // A board robots.txt disallows, or one that fails, counts as having no jobs.
    const jobs = await workdayJobCount(fetch, board.slug).catch(() => 0);
    const result = { checkedAt: new Date(), boardKey: jobs > 0 ? boardKey(board) : null };
    await this.prisma.jobBoardProbe.upsert({
      where: { key },
      create: { key, ...result },
      update: result,
    });
    return jobs > 0;
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
    // Links spell one board in different cases ("Campus", "campus"); the first spelling stays.
    const existing = new Map(
      (await this.prisma.discoveredJobBoard.findMany({ select: { key: true } })).map((board) => [
        board.key.toLowerCase(),
        board.key,
      ]),
    );
    const unique = new Map<string, FoundBoard>();
    for (const board of boards) {
      const lower = boardKey(board).toLowerCase();
      if (!catalog.has(lower) && !unique.has(lower)) unique.set(lower, board);
    }
    const found = [...unique].map(([lower, board]) => {
      const key = existing.get(lower);
      return key ? { ...board, slug: key.slice(board.provider.length + 1) } : board;
    });
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

  /** One run at a time: the cron fires every five minutes, and a run can last hours. */
  async refreshDue() {
    if (this.running) return { refreshed: 0, failed: 0, skipped: 0, imported: 0 };
    this.running = this.runDue();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async runDue() {
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
    // Workday boards share one request cap, so two workers at most take them; the third keeps the
    // other boards and feeds moving instead of queueing behind that cap.
    let workdayWorkers = 0;
    const next = () => {
      const index =
        workdayWorkers >= 2 ? pending.findIndex((row) => !row.key.startsWith("workday/")) : 0;
      return index < 0 ? undefined : pending.splice(index, 1)[0];
    };
    const worker = async () => {
      let onWorkday = false;
      for (;;) {
        if (onWorkday) workdayWorkers--;
        const row = next();
        onWorkday = !!row?.key.startsWith("workday/");
        if (!row) return;
        if (onWorkday) workdayWorkers++;
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
        // A discovered Workday board can take 100 requests, and new grads rarely need it hourly.
        if (!catalogBoard && board?.provider === "workday") interval = DAY;
        if (row.key === BOARD_DISCOVERY_KEY) interval = DAY;
        if (row.key === YC_DISCOVERY_KEY || row.key === CC_CHECK_KEY) interval = FEED_REFRESH_MS;
        if (row.key === CC_SCAN_KEY) interval = CC_SCAN_MS;
        try {
          let result = { fetched: 0, imported: 0, truncated: false };
          if (row.key === BOARD_DISCOVERY_KEY) {
            const boards = await this.discoverBoards();
            result = { fetched: boards, imported: 0, truncated: false };
          } else if (row.key === YC_DISCOVERY_KEY) {
            const { checked, found } = await this.discoverYcBoards();
            result = { fetched: checked, imported: found, truncated: false };
          } else if (row.key === CC_SCAN_KEY) {
            const { found, queued } = await this.scanCommonCrawl();
            result = { fetched: found, imported: queued, truncated: false };
          } else if (row.key === CC_CHECK_KEY) {
            const { checked, kept } = await this.checkCommonCrawl();
            result = { fetched: checked, imported: kept, truncated: false };
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
    await Promise.all(Array.from({ length: WORKERS }, worker));
    return counts;
  }
}

function byProvider(boards: Pick<FoundBoard, "provider">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const board of boards) counts[board.provider] = (counts[board.provider] ?? 0) + 1;
  return counts;
}
