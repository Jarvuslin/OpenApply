import type {
  CreatePilotSearchInput,
  ReportPilotSearchRunInput,
  UpdatePilotSearchInput,
} from "@openapply/contracts/pilot";
import { singleton } from "tsyringe";
import { HOUR_MS } from "@/common/date/buckets";
import { conflict, findOwned } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { AGENDA_SNAPSHOT_RESET } from "./agenda/snapshot";

/** A run with this many new jobs is "good": re-run it soon while the board is yielding. */
const GOOD_RUN_NEW_JOBS = 3;
const RERUN_GOOD_SEARCH_MS = 2 * HOUR_MS;
/** A thin run, or a good one that reached the board's end. */
const RERUN_SLOW_SEARCH_MS = 8 * HOUR_MS;
/** Consecutive empty runs climb this ladder and hold on its last rung. */
const EMPTY_RUN_BACKOFF_MS = [8 * HOUR_MS, 24 * HOUR_MS, 48 * HOUR_MS];

/** The next-run schedule after one discovery run. `emptyRuns` is the streak before this run. */
export function scheduleNextRun(emptyRuns: number, run: ReportPilotSearchRunInput, now: Date) {
  const at = (ms: number) => new Date(now.getTime() + ms);
  const recorded = { lastRunAt: now, lastJobsSeen: run.jobsSeen, lastNewJobs: run.newJobs };

  if (run.newJobs === 0) {
    const rung = EMPTY_RUN_BACKOFF_MS[Math.min(emptyRuns, EMPTY_RUN_BACKOFF_MS.length - 1)];
    return { ...recorded, emptyRuns: emptyRuns + 1, nextRunAt: at(rung) };
  }
  const stillYielding = run.newJobs >= GOOD_RUN_NEW_JOBS && !run.reachedEnd;
  return {
    ...recorded,
    emptyRuns: 0,
    nextRunAt: at(stillYielding ? RERUN_GOOD_SEARCH_MS : RERUN_SLOW_SEARCH_MS),
  };
}

/** The pilot's self-managed discovery searches. */
@singleton()
export class PilotSearchService {
  constructor(private readonly prisma: PrismaClient) {}

  private clearAgenda(userId: string) {
    return this.prisma.pilotState.updateMany({ where: { userId }, data: AGENDA_SNAPSHOT_RESET });
  }

  /**
   * A DB unique would treat two NULL boards as distinct, and a COALESCE index reads as schema drift
   * to Prisma. The pilot is the only writer, so losing a race costs a duplicate, not corruption.
   */
  private async assertUnique(
    userId: string,
    query: string,
    board: string | null,
    exceptId?: string,
  ) {
    const clash = await this.prisma.pilotSearch.findFirst({
      where: { userId, query, board, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw conflict("A search with this query and board already exists.");
  }

  private findOwnedSearch(userId: string, id: string) {
    return findOwned(
      (where) =>
        this.prisma.pilotSearch.findFirst({
          where,
          select: { query: true, board: true, emptyRuns: true },
        }),
      { id, userId },
      "Search",
    );
  }

  list(userId: string) {
    return this.prisma.pilotSearch.findMany({ where: { userId }, orderBy: { nextRunAt: "asc" } });
  }

  async create(userId: string, input: CreatePilotSearchInput) {
    const board = input.board ?? null;
    await this.assertUnique(userId, input.query, board);
    const row = await this.prisma.pilotSearch.create({
      data: {
        userId,
        query: input.query,
        board,
        resumeId: input.resumeId ?? null,
        reason: input.reason,
      },
    });
    await this.clearAgenda(userId);
    return row;
  }

  async update(userId: string, id: string, input: UpdatePilotSearchInput) {
    const existing = await this.findOwnedSearch(userId, id);
    const query = input.query ?? existing.query;
    const board = input.board === undefined ? existing.board : input.board;
    // A different query or board is a different search, so its schedule starts over.
    const isNewSearch = query !== existing.query || board !== existing.board;
    if (isNewSearch) await this.assertUnique(userId, query, board, id);

    const row = await this.prisma.pilotSearch.update({
      where: { id },
      data: {
        query: input.query,
        board: input.board,
        resumeId: input.resumeId,
        reason: input.reason,
        ...(isNewSearch
          ? { emptyRuns: 0, nextRunAt: new Date(), lastJobsSeen: null, lastNewJobs: null }
          : {}),
      },
    });
    await this.clearAgenda(userId);
    return row;
  }

  async remove(userId: string, id: string) {
    await this.findOwnedSearch(userId, id);
    await this.prisma.pilotSearch.delete({ where: { id } });
    await this.clearAgenda(userId);
    return { deleted: id };
  }

  async reportRun(userId: string, id: string, input: ReportPilotSearchRunInput) {
    const existing = await this.findOwnedSearch(userId, id);
    const row = await this.prisma.pilotSearch.update({
      where: { id },
      data: scheduleNextRun(existing.emptyRuns, input, new Date()),
    });
    await this.clearAgenda(userId);
    return row;
  }
}
