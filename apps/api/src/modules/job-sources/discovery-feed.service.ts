import { discoveryConnectionSchema } from "@openapply/contracts/job-sources";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { PrismaClient } from "@/generated/prisma/client";
import { CATALOG_FEED_KEYS, JOB_FEED_CATALOG, PUBLIC_FEED_CATALOG } from "./catalog";
import { CatalogRefreshService } from "./catalog-refresh.service";

type FeedState = {
  key: string;
  lastSuccessAt: Date | null;
  nextRefreshAt: Date;
  leaseUntil: Date | null;
  lastError: string | null;
};
type CoverageSource = {
  id: string;
  name: string;
  status: "connected" | "needs_setup" | "unavailable" | "error" | "pending";
  details: string;
  lastSuccessAt: Date | null;
  nextRefreshAt: Date | null;
};

function sourceStatus(
  id: string,
  name: string,
  details: string,
  keys: string[],
  rows: FeedState[],
): CoverageSource {
  const states = rows.filter((row) => keys.includes(row.key));
  const successful = states.flatMap((row) => (row.lastSuccessAt ? [row.lastSuccessAt] : []));
  const nextDates = states.map((row) => row.nextRefreshAt.getTime());
  let status: CoverageSource["status"] = "pending";
  if (successful.length) status = "connected";
  if (states.some((row) => row.lastError)) status = "error";
  const failed = states.filter((row) => row.lastError).length;
  return {
    id,
    name,
    status,
    details: `${details}${failed ? ` ${failed} feed(s) failed their latest refresh; saved jobs remain available.` : ""}`,
    lastSuccessAt: successful.length
      ? new Date(Math.max(...successful.map((date) => date.getTime())))
      : null,
    nextRefreshAt: nextDates.length ? new Date(Math.min(...nextDates)) : null,
  };
}

@singleton()
export class DiscoveryFeedService {
  private nextRequestAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly refresh: CatalogRefreshService,
  ) {}

  async coverage(userId: string) {
    const [rows, connections, linkedin, linkedinRun] = await Promise.all([
      this.prisma.jobFeedRefresh.findMany({ where: { key: { in: CATALOG_FEED_KEYS } } }),
      this.prisma.jobSourceConnection.findMany({ where: { userId, enabled: true } }),
      this.prisma.linkedinDiscoverySettings.findUnique({ where: { userId } }),
      this.prisma.linkedinDiscoveryRun.findFirst({
        where: { userId, status: "completed" },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
    ]);
    const sources: CoverageSource[] = [];
    for (const [id, name] of [
      ["greenhouse", "Greenhouse"],
      ["ashby", "Ashby"],
      ["lever", "Lever"],
      ["smartrecruiters", "SmartRecruiters"],
      ["workable", "Workable"],
    ]) {
      const boards = JOB_FEED_CATALOG.filter((board) => board.provider === id);
      if (boards.length) {
        sources.push(
          sourceStatus(
            id,
            name,
            `${boards.length} selected employer boards, checked every 30 minutes; not the entire ATS network.`,
            boards.map((board) => `${board.provider}/${board.slug}`),
            rows,
          ),
        );
      } else {
        sources.push({
          id,
          name,
          status: "needs_setup",
          details: "Import adapter available; no employers configured in the shared catalog yet.",
          lastSuccessAt: null,
          nextRefreshAt: null,
        });
      }
    }
    for (const feed of PUBLIC_FEED_CATALOG)
      sources.push(sourceStatus(feed.id, feed.name, feed.details, [`public/${feed.id}`], rows));
    const backoff = linkedin?.backoffUntil && linkedin.backoffUntil > new Date();
    sources.push({
      id: "linkedin-jobspy",
      name: "LinkedIn · logged-out discovery",
      status: !linkedin?.enabled
        ? "needs_setup"
        : backoff
          ? "error"
          : linkedinRun
            ? "connected"
            : "pending",
      details: !linkedin?.enabled
        ? "Optional personal discovery is off. Configure saved searches in Settings → Connections."
        : backoff
          ? "The last run stopped; collection is paused for 24 hours. Existing personal results remain available."
          : "Enabled for your account. The separate JobSpy worker checks at most four saved searches daily; LinkedIn applications remain blocked.",
      lastSuccessAt: linkedinRun?.completedAt ?? null,
      nextRefreshAt: linkedin?.enabled ? linkedin.nextRunAt : null,
    });
    const apify = connections.find((row) => row.provider === "apify");
    const config = apify
      ? discoveryConnectionSchema.safeParse({ ...(apify.config as object), enabled: true })
      : null;
    for (const [id, name, actor] of [
      ["linkedin", "LinkedIn", "linkedinActor"],
      ["indeed", "Indeed", "indeedActor"],
      ["glassdoor", "Glassdoor", "glassdoorActor"],
      ["ycombinator", "Y Combinator", "ycombinatorActor"],
    ] as const) {
      const connected = config?.success && Boolean(config.data[actor]);
      sources.push({
        id,
        name,
        status: connected ? "connected" : "needs_setup",
        details: connected
          ? "On-demand via your configured Apify actor; availability and coverage depend on that actor."
          : "Requires an enabled Apify connection and a compatible board actor; no direct database access.",
        lastSuccessAt: null,
        nextRefreshAt: null,
      });
    }
    const googleConnected = connections.some((row) => row.provider === "serpapi");
    sources.push(
      {
        id: "google_jobs",
        name: "Google Jobs",
        status: googleConnected ? "connected" : "needs_setup",
        details: googleConnected
          ? "On-demand searches via your SerpApi connection; provider fees and quotas apply."
          : "Requires an enabled SerpApi connection for on-demand searches.",
        lastSuccessAt: null,
        nextRefreshAt: null,
      },
      {
        id: "hiringcafe",
        name: "HiringCafe",
        status: "connected",
        details:
          "Private on-demand previews from the official MCP search, up to 25 results; not a shared feed.",
        lastSuccessAt: null,
        nextRefreshAt: null,
      },
    );
    const updated = rows.flatMap((row) => (row.lastSuccessAt ? [row.lastSuccessAt.getTime()] : []));
    return {
      sources,
      refreshing: rows.some((row) => row.leaseUntil && row.leaseUntil > new Date()),
      lastUpdatedAt: updated.length ? new Date(Math.max(...updated)) : null,
    };
  }

  async requestRefresh(userId: string, enabled: boolean) {
    const scheduled = enabled && Date.now() >= this.nextRequestAt;
    if (scheduled) {
      this.nextRequestAt = Date.now() + 30_000;
      // Refresh respects durable source leases and due times, even across API instances.
      void this.refresh.refreshDue().catch((err: unknown) => {
        logger.error({ err }, "Requested job feed refresh failed");
      });
    }
    return { scheduled, ...(await this.coverage(userId)) };
  }
}
