import type { AgendaPayload } from "@openapply/contracts/pilot";
import { HOUR_MS } from "@/common/date/buckets";
import type { PrismaClient } from "@/generated/prisma/client";
import { GATHER_CAP } from "./items";

/** With room left under the apply cap, a search idle this long re-runs before it is due. */
const HUNGRY_RERUN_MS = 6 * HOUR_MS;

export type DueSearch = Pick<
  AgendaPayload<"search.discover">,
  "searchId" | "query" | "board" | "resumeId" | "campaignId"
>;

/**
 * Searches whose `nextRunAt` has come due. When none are and the apply cap still has room, the most
 * overdue idle search runs anyway.
 */
export async function gatherDueSearches(
  prisma: PrismaClient,
  userId: string,
  now: Date,
  hungry: boolean,
): Promise<{ dueQueries: DueSearch[]; nextSearchRunAt: Date | null }> {
  const searches = await prisma.pilotSearch.findMany({
    where: { userId },
    orderBy: { nextRunAt: "asc" },
    take: GATHER_CAP,
    select: {
      id: true,
      query: true,
      board: true,
      resumeId: true,
      nextRunAt: true,
      lastRunAt: true,
    },
  });
  if (searches.length === 0) return { dueQueries: [], nextSearchRunAt: null };

  // Keyed by search id, not query, so a rewritten query still reuses its campaign.
  const campaigns = await prisma.campaign.findMany({
    where: {
      userId,
      status: "in_progress",
      source: "auto_apply",
      pilotSearchId: { in: searches.map((search) => search.id) },
    },
    orderBy: { startedAt: "asc" },
    select: { campaignId: true, pilotSearchId: true },
  });
  // Oldest first, so the newest campaign of a search wins the map entry.
  const campaignBySearch = new Map(campaigns.map((c) => [c.pilotSearchId, c.campaignId]));

  let due = searches.filter((search) => search.nextRunAt <= now);
  if (due.length === 0 && hungry) {
    const idleSince = now.getTime() - HUNGRY_RERUN_MS;
    due = searches
      .filter((search) => !search.lastRunAt || search.lastRunAt.getTime() < idleSince)
      .slice(0, 1);
  }
  return {
    dueQueries: due.map((search) => ({
      searchId: search.id,
      query: search.query,
      board: search.board ?? undefined,
      resumeId: search.resumeId ?? undefined,
      campaignId: campaignBySearch.get(search.id),
    })),
    nextSearchRunAt: searches[0].nextRunAt,
  };
}
