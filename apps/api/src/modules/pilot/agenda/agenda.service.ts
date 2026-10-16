import {
  type AgendaResponse,
  type PilotInstructionsConfig,
  resolvePilotInstructionsConfig,
} from "@openapply/contracts/pilot";
import { DEFAULT_MIN_MATCH_SCORE } from "@openapply/contracts/user";
import { singleton } from "tsyringe";
import { conflict } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { PrismaClient } from "@/generated/prisma/client";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { EmailSyncService } from "@/modules/email/sync/sync.service";
import { PilotJournalService } from "../journal.service";
import { countAppliedToday } from "../pilot.stats";
import { type AgendaInput, buildAgenda, isPipelineQuiet } from "./build";
import { writeDigestIfDue } from "./digest";
import {
  gatherCampaignReviews,
  gatherPausedCampaigns,
  gatherQueueDrains,
  gatherScorePending,
} from "./gather-campaigns";
import { gatherAnsweredQuestions, gatherInbox, gatherInterviewReplies } from "./gather-inbox";
import { gatherApprovedJobs, gatherBoardHealth } from "./gather-jobs";
import { gatherDueSearches } from "./gather-searches";
import { finalizeIdleCampaigns, promoteScoredPendingJobs, runExpiry } from "./maintenance";
import { parseAgendaSnapshot } from "./snapshot";

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
/** The default check interval: idle cycles always pull mail, busy 15s cycles don't. */
export const INBOX_SYNC_STALE_MS = 30 * 60 * 1000;

type Gathered = Omit<AgendaInput, "now" | "config" | "cycleCount">;

const NO_DUE_SEARCHES: Pick<Gathered, "dueQueries" | "nextSearchRunAt"> = {
  dueQueries: [],
  nextSearchRunAt: null,
};
const NO_REVIEWS: Pick<Gathered, "strategyReviews" | "rescanSkipped" | "retryFailed"> = {
  strategyReviews: [],
  rescanSkipped: [],
  retryFailed: [],
};

/** `Promise.all` over named promises, so a long parallel read can't misalign its results. */
async function allNamed<T extends Record<string, unknown>>(
  named: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const values = await Promise.all(Object.values(named));
  const keys = Object.keys(named);
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as {
    [K in keyof T]: Awaited<T[K]>;
  };
}

@singleton()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly campaignJobs: CampaignJobService,
    private readonly journal: PilotJournalService,
    private readonly emailSync: EmailSyncService,
  ) {}

  /** The current snapshot, with none of refresh's writes. */
  async getCurrent(userId: string) {
    const state = await this.prisma.pilotState.findUnique({ where: { userId } });
    if (!state?.running) throw conflict("Pilot is stopped.");
    if (!state.agendaSnapshot || !state.agendaExpiresAt || state.agendaExpiresAt <= new Date()) {
      return { agenda: null };
    }
    return { agenda: parseAgendaSnapshot(state.agendaSnapshot) };
  }

  async refresh(userId: string): Promise<AgendaResponse> {
    const [state, defaults] = await Promise.all([
      this.prisma.pilotState.findUnique({
        where: { userId },
        select: {
          running: true,
          cycleCount: true,
          instructionsConfig: true,
          instructionsGoals: true,
        },
      }),
      this.prisma.autoApplySettings.findUnique({
        where: { userId },
        select: { minMatchScore: true },
      }),
    ]);
    if (!state?.running) throw conflict("Pilot is stopped.");

    const now = new Date();
    const { config } = resolvePilotInstructionsConfig(
      state.instructionsConfig,
      defaults?.minMatchScore,
    );
    const campaignMinimum = defaults?.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;

    // Mail first so inbox.review sees it; promotion before finalize so fresh approvals keep a
    // campaign open.
    await this.emailSync.syncIfStale(userId, INBOX_SYNC_STALE_MS, now);
    await runExpiry(this.prisma, userId, now);
    await promoteScoredPendingJobs(this.prisma, this.campaignJobs, userId, campaignMinimum);
    await finalizeIdleCampaigns(this.prisma, this.journal, userId, now);

    const gathered = await this.gather(
      userId,
      config,
      campaignMinimum,
      state.instructionsGoals.trim(),
      now,
    );
    const deps = { prisma: this.prisma, journal: this.journal };
    void writeDigestIfDue(deps, userId, now, gathered.openQuestions);

    const agenda: AgendaResponse = {
      ...buildAgenda({ ...gathered, now, config, cycleCount: state.cycleCount }),
      version: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS),
    };
    await this.prisma.pilotState.update({
      where: { userId },
      data: {
        agendaVersion: agenda.version,
        agendaGeneratedAt: agenda.generatedAt,
        agendaExpiresAt: agenda.expiresAt,
        agendaSnapshot: toInputJson(agenda),
      },
    });
    return agenda;
  }

  private async gather(
    userId: string,
    config: PilotInstructionsConfig,
    campaignMinimum: number,
    goals: string,
    now: Date,
  ): Promise<Gathered> {
    const { prisma } = this;

    const { searchCount, ...base } = await allNamed({
      openQuestions: prisma.pilotQuestion.count({ where: { userId, status: "open" } }),
      searchCount: prisma.pilotSearch.count({ where: { userId } }),
      appliedToday: countAppliedToday(prisma, userId, now),

      answeredQuestions: gatherAnsweredQuestions(prisma, userId),
      approvedJobs: gatherApprovedJobs(prisma, userId),
      queueDrains: gatherQueueDrains(prisma, userId, campaignMinimum),
      pausedCampaigns: gatherPausedCampaigns(prisma, userId),
      boardHealth: gatherBoardHealth(prisma, userId),
      inbox: gatherInbox(prisma, userId),
      interviewReplies: gatherInterviewReplies(prisma, userId),
    });

    const hungry = base.appliedToday < config.dailyApplyCap;
    // Scoring and discovery only matter once nothing approved is left to apply to.
    const drained = base.approvedJobs.length === 0;
    const [searches, scorePending] = await Promise.all([
      drained ? gatherDueSearches(prisma, userId, now, hungry) : NO_DUE_SEARCHES,
      drained ? gatherScorePending(prisma, userId, campaignMinimum) : [],
    ]);
    const quiet = isPipelineQuiet({ ...base, ...searches, scorePending });
    // Blank goals need no item: emptyReason "awaitingSetup" already says so.
    const canBootstrap = quiet && searchCount === 0 && goals !== "";
    const reviews = quiet ? await gatherCampaignReviews(prisma, userId, now) : NO_REVIEWS;
    const bootstrap = canBootstrap ? { goals, minScore: config.minScore } : null;

    return {
      ...base,
      ...searches,
      ...reviews,

      scorePending,
      bootstrap,
      awaitingSetup: searchCount === 0 || goals === "",
    };
  }
}
