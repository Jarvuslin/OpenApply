import {
  type discoverSearchInputSchema,
  discoverSearchResultSchema,
} from "@openapply/contracts/discover-feed";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { sha256 } from "@/common/crypto/hash";
import { conflict } from "@/common/errors";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hiringCafeSearch } from "./hiringcafe";
import { fetchSourceJson } from "./http";
import { JobSourcesService } from "./job-sources.service";

type SearchInput = z.infer<typeof discoverSearchInputSchema>;
type SearchResult = z.infer<typeof discoverSearchResultSchema>;
const DAY = 86_400_000;
const COOLDOWN = 60_000;
const PAGE_BUDGET = 10;

function searchKey(userId: string, input: SearchInput) {
  return sha256(
    JSON.stringify([
      userId,
      input.provider,
      input.board ?? "",
      input.query.toLowerCase().replace(/\s+/g, " "),
      input.location.toLowerCase().replace(/\s+/g, " "),
      input.limit,
    ]),
  );
}

function cachedResult(lastResult: unknown, message: string, hasMore: boolean): SearchResult {
  const result = discoverSearchResultSchema.safeParse(lastResult);
  return {
    imported: result.success ? result.data.imported : 0,
    fetched: result.success ? result.data.fetched : 0,
    cached: true,
    hasMore,
    message,
  };
}

@singleton()
export class DiscoverySearchService {
  private previews = new Map<string, { expires: number; result: Promise<SearchResult> }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: JobSourcesService,
  ) {}

  async search(userId: string, input: SearchInput): Promise<SearchResult> {
    const key = searchKey(userId, input);
    if (input.provider === "hiringcafe") return this.privatePreview(key, input);
    const connection = await this.prisma.jobSourceConnection.findUnique({
      where: { userId_provider: { userId, provider: input.provider } },
      select: { enabled: true },
    });
    if (!connection?.enabled)
      throw conflict(
        "Add and enable your own provider API key in Settings → Connections before searching this source.",
      );
    await this.prisma.jobSourceSearch.createMany({ data: [{ key }], skipDuplicates: true });
    const now = new Date();
    const leaseAvailable = [{ leaseUntil: null }, { leaseUntil: { lte: now } }];
    await this.prisma.jobSourceSearch.updateMany({
      where: { key, budgetStartedAt: { lte: new Date(now.getTime() - DAY) }, OR: leaseAvailable },
      data: {
        pages: 0,
        budgetStartedAt: now,
        nextCursor: null,
        exhausted: false,
        lastBatchAt: null,
        lastResult: Prisma.DbNull,
      },
    });
    const state = await this.prisma.jobSourceSearch.findUniqueOrThrow({ where: { key } });
    if (state.pages >= PAGE_BUDGET)
      return cachedResult(
        state.lastResult,
        "Today's limit of 10 batches for this search is reached. Try again tomorrow or refine the search.",
        false,
      );
    if (state.exhausted)
      return cachedResult(
        state.lastResult,
        "This source returned its last batch. Refine the search to find different jobs, or check again tomorrow.",
        false,
      );
    if (state.lastBatchAt && state.lastBatchAt.getTime() + COOLDOWN > now.getTime())
      return cachedResult(
        state.lastResult,
        "Search requests are limited to one batch per minute. Wait briefly before requesting another batch.",
        true,
      );
    const leaseToken = crypto.randomUUID();
    const claimed = await this.prisma.jobSourceSearch.updateMany({
      where: {
        key,
        exhausted: false,
        pages: { lt: PAGE_BUDGET },
        AND: [
          { OR: leaseAvailable },
          {
            OR: [
              { lastBatchAt: null },
              { lastBatchAt: { lte: new Date(now.getTime() - COOLDOWN) } },
            ],
          },
        ],
      },
      data: {
        leaseToken,
        leaseUntil: new Date(now.getTime() + 10 * 60_000),
        pages: { increment: 1 },
        lastBatchAt: now,
      },
    });
    if (!claimed.count)
      return cachedResult(
        state.lastResult,
        "A search for these filters is already running. Check again shortly.",
        true,
      );
    try {
      const result = await this.sources.discoverPage(
        userId,
        { ...input, provider: input.provider },
        state.nextCursor,
      );
      const nextCursor = result.nextCursor !== state.nextCursor ? result.nextCursor : null;
      const hasMore = Boolean(nextCursor) && state.pages + 1 < PAGE_BUDGET;
      let message = "The source returned its last batch. Refine the search to find different jobs.";
      if (nextCursor)
        message = "Jobs imported. The next provider page is available after a one-minute cooldown.";
      if (state.pages + 1 >= PAGE_BUDGET)
        message = "Jobs imported. Today's 10-batch limit for this search is reached.";
      const response: SearchResult = {
        imported: result.imported,
        fetched: result.fetched,
        cached: false,
        hasMore,
        message,
      };
      await this.prisma.jobSourceSearch.updateMany({
        where: { key, leaseToken },
        data: {
          nextCursor,
          exhausted: !nextCursor,
          lastResult: response,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      return response;
    } catch (error) {
      await this.prisma.jobSourceSearch.updateMany({
        where: { key, leaseToken },
        data: { leaseToken: null, leaseUntil: null },
      });
      throw error;
    }
  }

  private async privatePreview(key: string, input: SearchInput): Promise<SearchResult> {
    const now = Date.now();
    for (const [entryKey, entry] of this.previews)
      if (entry.expires <= now) this.previews.delete(entryKey);
    const cached = this.previews.get(key);
    if (cached) return { ...(await cached.result), cached: true };
    if (this.previews.size >= 100) {
      const oldest = this.previews.keys().next().value;
      if (oldest) this.previews.delete(oldest);
    }
    const result = hiringCafeSearch(fetchSourceJson, input).then(
      ({ jobs }): SearchResult => ({
        imported: 0,
        fetched: jobs.length,
        cached: false,
        hasMore: false,
        message:
          "Private HiringCafe preview. This search returns up to 25 jobs with no next-page API; refine your filters for more. Results are not stored in the shared index.",
        jobs: jobs.map((job) => ({
          title: job.title,
          company: job.company,
          location: job.location,
          description: job.description,
          postedAt: job.postedAt,
          url: job.attributionUrl,
        })),
      }),
    );
    this.previews.set(key, { expires: now + 15 * 60_000, result });
    try {
      return await result;
    } catch (error) {
      this.previews.delete(key);
      throw error;
    }
  }
}
