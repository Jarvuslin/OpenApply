import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/** Complete refreshes in a row a source must be missing from before it counts as gone. */
const MISSED_LIMIT = 3;

/** The rows one refresh speaks for: a board's own postings, or a feed's, and the refresh's key. */
export type ExpiryScope = ({ boardKey: string } | { board: string }) & { refreshKey: string };

/**
 * After a complete refresh, counts a miss on each of the scope's public rows it didn't list, marks
 * a row gone on its third miss in a row, and expires a listing once every public row is gone. Jobs
 * the tech filter dropped are still posted, so they never count. Only published listings expire.
 */
export async function sweepMissing(prisma: PrismaClient, scope: ExpiryScope, since: Date) {
  const where =
    "boardKey" in scope
      ? Prisma.sql`board_key = ${scope.boardKey.toLowerCase()}`
      : Prisma.sql`board = ${scope.board.toLowerCase()}`;
  const missed = await prisma.$queryRaw<{ listing_id: string; gone: boolean }[]>`
    update job_listing_sources set
      missed_refreshes = missed_refreshes + 1,
      gone_at = case when missed_refreshes + 1 >= ${MISSED_LIMIT} then now() end
    where ${where} and is_public and gone_at is null and last_seen_at < ${since}
      -- A job the tech filter dropped is still on the board; it isn't gone.
      and not exists (
        select 1 from dropped_jobs d
        where d.board_key = ${scope.refreshKey} and d.job_id = job_listing_sources.external_id)
    returning listing_id, gone_at is not null as gone`;
  const goneListings = [...new Set(missed.filter((row) => row.gone).map((row) => row.listing_id))];
  if (!goneListings.length) return { missed: missed.length, gone: 0, expired: 0 };
  const expired = await prisma.$executeRaw`
    update job_listings l set status = 'expired', expired_at = now()
    where l.id in (${Prisma.join(goneListings)}) and l.status = 'published'
      and not exists (
        select 1 from job_listing_sources s
        where s.listing_id = l.id and s.is_public and s.gone_at is null)`;
  return {
    missed: missed.length,
    gone: missed.filter((row) => row.gone).length,
    expired,
  };
}
