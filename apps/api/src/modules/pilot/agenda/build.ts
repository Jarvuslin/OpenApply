import {
  type AgendaContent,
  type AgendaItem,
  type AgendaPayload,
  type PilotInstructionsConfig,
} from "@openapply/contracts/pilot";
import { nextDayReset } from "@/common/date/buckets";
import type { AgendaJob } from "./gather-jobs";
import type { DueSearch } from "./gather-searches";
import {
  applyItem,
  boardHealthItem,
  bootstrapItem,
  discoverItem,
  inboxItem,
  interviewReplyItem,
  questionItem,
  queueDrainItem,
  rescanSkippedItem,
  retryFailedItem,
  reviewPausedItem,
  scorePendingItem,
  strategyReviewItem,
} from "./items";

const MAX_ITEMS = 10;
const MAX_TITLE_LENGTH = 200;
/** Per-agenda caps keep one cycle focused; the rest drain over later cycles. */
const PER_AGENDA = {
  boardHealth: 1,
  reviewPaused: 1,
  interviewReply: 2,

  maintenance: 1,
} as const;
const ACTIVE_SLEEP_SECONDS = 15;
/** Floors a tiny `checkIntervalMinutes` so the loop can't spin. */
const MIN_IDLE_SLEEP_SECONDS = 30;
/** A backed-off pilot still wakes within the day. */
const MAX_IDLE_SLEEP_SECONDS = 6 * 60 * 60;
const NEW_JOBS_TARGET_MIN = 5;
const NEW_JOBS_TARGET_MAX = 20;
const SEARCH_MAX_PAGES = 5;

export interface AgendaInput {
  now: Date;
  config: PilotInstructionsConfig;
  // Rotates discovery across the configured boards.
  cycleCount: number;
  openQuestions: number;
  activeClaims: number;
  appliedToday: number;

  // No searches yet, or no goals to derive them from.
  awaitingSetup: boolean;
  // The idle sleep never runs past this.
  nextSearchRunAt: Date | null;
  answeredQuestions: AgendaPayload<"question.answered">[];
  approvedJobs: AgendaJob[];

  dueQueries: DueSearch[];
  scorePending: AgendaPayload<"campaign.scorePending">[];
  queueDrains: AgendaPayload<"queue.drain">[];
  pausedCampaigns: AgendaPayload<"campaign.reviewPaused">[];
  boardHealth: AgendaPayload<"board.health">[];
  inbox: AgendaPayload<"inbox.review">;
  interviewReplies: AgendaPayload<"interview.reply">[];

  strategyReviews: AgendaPayload<"campaign.strategyReview">[];
  rescanSkipped: AgendaPayload<"job.rescanSkipped">[];
  retryFailed: AgendaPayload<"job.retryFailed">[];
  bootstrap: AgendaPayload<"strategy.bootstrap"> | null;
}

type PipelineWork = Pick<
  AgendaInput,
  "approvedJobs" | "dueQueries" | "scorePending" | "queueDrains"
>;

/** Bootstrap and campaign reviews wait until no apply, discovery or scoring work is queued. */
export function isPipelineQuiet(work: PipelineWork): boolean {
  const { approvedJobs, dueQueries, scorePending, queueDrains } = work;
  return approvedJobs.length + dueQueries.length + scorePending.length + queueDrains.length === 0;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Ranks already-gathered work into the agenda. Pure, so every gating rule is unit-testable. */
export function buildAgenda(input: AgendaInput): AgendaContent {
  const { now, config } = input;
  const capReached = input.appliedToday >= config.dailyApplyCap;

  const items: AgendaItem[] = [
    ...input.answeredQuestions.map(questionItem),
    ...input.boardHealth.slice(0, PER_AGENDA.boardHealth).map(boardHealthItem),
    ...input.pausedCampaigns.slice(0, PER_AGENDA.reviewPaused).map(reviewPausedItem),
    ...input.interviewReplies.slice(0, PER_AGENDA.interviewReply).map(interviewReplyItem),
    ...input.queueDrains.map(queueDrainItem),
  ];
  if (!capReached) items.push(...input.approvedJobs.map(applyItem));
  if (input.inbox.count > 0) items.push(inboxItem(input.inbox));

  // Scoring and discovery only matter once nothing approved is left to apply to.
  if (input.approvedJobs.length === 0) {
    const { boards } = config;
    const rotatedBoard = boards.length > 0 ? boards[input.cycleCount % boards.length] : undefined;
    const newJobsTarget = clamp(
      config.dailyApplyCap - input.appliedToday,
      NEW_JOBS_TARGET_MIN,
      NEW_JOBS_TARGET_MAX,
    );
    items.push(
      ...input.scorePending.map(scorePendingItem),
      ...input.dueQueries.map((search) =>
        discoverItem({
          ...search,
          board: rotatedBoard ?? search.board,
          minScore: config.minScore,
          newJobsTarget,
          maxPages: SEARCH_MAX_PAGES,
        }),
      ),
    );
  }

  if (isPipelineQuiet(input)) {
    if (input.bootstrap) items.push(bootstrapItem(input.bootstrap));
    items.push(
      ...input.strategyReviews.slice(0, PER_AGENDA.maintenance).map(strategyReviewItem),
      ...input.rescanSkipped.slice(0, PER_AGENDA.maintenance).map(rescanSkippedItem),
      ...input.retryFailed.slice(0, PER_AGENDA.maintenance).map(retryFailedItem),
    );
  }

  const ranked = items
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_ITEMS)
    .map((item) => ({ ...item, title: item.title.slice(0, MAX_TITLE_LENGTH) }));

  const secondsUntilSearch = input.nextSearchRunAt
    ? Math.max(0, Math.round((input.nextSearchRunAt.getTime() - now.getTime()) / 1000))
    : Number.POSITIVE_INFINITY;
  const idleSleep = clamp(
    Math.min(config.checkIntervalMinutes * 60, secondsUntilSearch),
    MIN_IDLE_SLEEP_SECONDS,
    MAX_IDLE_SLEEP_SECONDS,
  );
  const sleepSeconds = ranked.length > 0 ? ACTIVE_SLEEP_SECONDS : idleSleep;

  return {
    generatedAt: now,
    items: ranked,
    counts: {
      openQuestions: input.openQuestions,
      activeClaims: input.activeClaims,
      approvedJobs: input.approvedJobs.length,
      appliedToday: input.appliedToday,
    },
    budget: {
      dailyApplyCap: config.dailyApplyCap,
      appliedToday: input.appliedToday,
      capReached,

      resetsAt: nextDayReset(now),
    },
    emptyReason: emptyReason(ranked.length, capReached, input.awaitingSetup),
    sleepSeconds,
    nextWakeAt: new Date(now.getTime() + sleepSeconds * 1000),
  };
}

/** Named so clients render why the agenda is empty instead of re-deriving the gating rules. */
function emptyReason(
  itemCount: number,
  capReached: boolean,
  awaitingSetup: boolean,
): AgendaContent["emptyReason"] {
  if (itemCount > 0) return null;
  if (capReached) return "capReached";
  if (awaitingSetup) return "awaitingSetup";
  return "clear";
}
