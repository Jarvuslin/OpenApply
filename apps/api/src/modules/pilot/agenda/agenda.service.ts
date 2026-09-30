import {
  type AgendaResponse,
  channelAutonomy,
  networkingMode,
  type PilotInstructionsConfig,
  pilotInstructionsConfigSchema,
} from "@jobpilot/contracts/pilot";
import { singleton } from "tsyringe";
import { conflict } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { PushService } from "@/common/push/push.service";
import { PrismaClient } from "@/generated/prisma/client";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { EmailSyncService } from "@/modules/email/sync/sync.service";
import { PilotJournalService } from "../journal.service";
import { countAppliedToday, countSentToday } from "../pilot.stats";
import { type AgendaInput, buildAgenda, isPipelineQuiet } from "./build";
import { writeDigestIfDue } from "./digest";
import {
  gatherCampaignReviews,
  gatherPausedCampaigns,
  gatherQueueDrains,
  gatherScorePending,
} from "./gather-campaigns";
import {
  gatherAnsweredQuestions,
  gatherInbox,
  gatherInterviewPreps,
  gatherInterviewReplies,
  gatherUpworkSync,
} from "./gather-inbox";
import {
  attachWarmContacts,
  gatherApprovedJobs,
  gatherBoardHealth,
  gatherWarmIntroCandidates,
} from "./gather-jobs";
import {
  gatherApprovedNetworking,
  gatherApprovedPromotions,
  gatherDuePlatforms,
  gatherFollowups,
} from "./gather-outreach";
import { gatherBootstrap, gatherDueSearches } from "./gather-searches";
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
    private readonly push: PushService,
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
    const state = await this.prisma.pilotState.findUnique({
      where: { userId },
      select: {
        running: true,
        cycleCount: true,
        instructionsConfig: true,
        instructionsGoals: true,
      },
    });
    if (!state?.running) throw conflict("Pilot is stopped.");

    const now = new Date();
    const config = pilotInstructionsConfigSchema.parse(state.instructionsConfig);

    // Mail first so inbox.review sees it; promotion before finalize so fresh approvals keep a
    // campaign open.
    await this.emailSync.syncIfStale(userId, INBOX_SYNC_STALE_MS, now);
    await runExpiry(this.prisma, userId, now);
    await promoteScoredPendingJobs(this.prisma, this.campaignJobs, userId, config.minScore);
    await finalizeIdleCampaigns(this.prisma, this.journal, userId, now);

    const gathered = await this.gather(userId, config, state.instructionsGoals.trim(), now);
    const deps = { prisma: this.prisma, journal: this.journal, push: this.push };
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
    goals: string,
    now: Date,
  ): Promise<Gathered> {
    const { prisma } = this;
    // Off channels skip their reads entirely; sends and followups only ever act on email.
    const emailOn = channelAutonomy(config, "email") !== null;
    const outreachOn = networkingMode(config) !== null;

    const { searchCount, ...base } = await allNamed({
      openQuestions: prisma.pilotQuestion.count({ where: { userId, status: "open" } }),
      activeClaims: prisma.pilotClaim.count({
        where: { userId, releasedAt: null, expiresAt: { gt: now } },
      }),
      searchCount: prisma.pilotSearch.count({ where: { userId } }),
      appliedToday: countAppliedToday(prisma, userId, now),
      networkingSentToday: outreachOn ? countSentToday(prisma, userId, now) : 0,
      answeredQuestions: gatherAnsweredQuestions(prisma, userId),
      approvedJobs: gatherApprovedJobs(prisma, userId),
      queueDrains: gatherQueueDrains(prisma, userId, config.minScore, now),
      pausedCampaigns: gatherPausedCampaigns(prisma, userId, now),
      boardHealth: gatherBoardHealth(prisma, userId),
      inbox: gatherInbox(prisma, userId),
      interviewReplies: gatherInterviewReplies(prisma, userId),
      interviewPreps: gatherInterviewPreps(prisma, userId),
      upworkSync: gatherUpworkSync(prisma, userId, now),
      approvedNetworking: emailOn ? gatherApprovedNetworking(prisma, userId) : [],
      followups: emailOn ? gatherFollowups(prisma, userId, config, now) : [],
      approvedPromotions: gatherApprovedPromotions(prisma, userId, now),
      duePlatforms: gatherDuePlatforms(prisma, userId, config, now),
    });

    const canSend = base.networkingSentToday < config.networking.dailyCap;
    const hungry = base.appliedToday < config.dailyApplyCap;
    // Scoring and discovery only matter once nothing approved is left to apply to.
    const drained = base.approvedJobs.length === 0;
    const [warmIntroCandidates, searches, scorePending] = await Promise.all([
      outreachOn && canSend
        ? gatherWarmIntroCandidates(prisma, userId, now, base.approvedJobs)
        : [],
      drained ? gatherDueSearches(prisma, userId, now, hungry) : NO_DUE_SEARCHES,
      drained ? gatherScorePending(prisma, userId, config.minScore, now) : [],
    ]);
    // A job can sit in both lists; the Set keeps one contacts pass per job.
    await attachWarmContacts(prisma, userId, [
      ...new Set([...base.approvedJobs, ...warmIntroCandidates]),
    ]);

    const quiet = isPipelineQuiet({ ...base, ...searches, scorePending });
    // Blank goals need no item: emptyReason "awaitingSetup" already says so.
    const canBootstrap = quiet && searchCount === 0 && goals !== "";
    const [reviews, bootstrap] = await Promise.all([
      quiet ? gatherCampaignReviews(prisma, userId, now) : NO_REVIEWS,
      canBootstrap
        ? gatherBootstrap(prisma, userId, { goals, minScore: config.minScore }, now)
        : null,
    ]);

    return {
      ...base,
      ...searches,
      ...reviews,
      warmIntroCandidates,
      scorePending,
      bootstrap,
      awaitingSetup: searchCount === 0 || goals === "",
    };
  }
}
