import {
  type PilotInstructionsChange,
  type PilotInstructionsImpact,
  type PilotState,
  pilotCycleDetailSchema,
  pilotInstructionsConfigSchema,
  type UpdatePilotInstructionsInput,
} from "@openapply/contracts/pilot";
import { pilotChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { conflict } from "@/common/errors";
import { publish } from "@/common/sse";
import { type PilotState as PilotStateModel, PrismaClient } from "@/generated/prisma/client";
import { publishCampaignStatus } from "@/modules/campaign/campaign.utils";
import { AGENDA_SNAPSHOT_RESET } from "./agenda/snapshot";
import { costByKind, countAppliedToday, countTodayOutcomes } from "./pilot.stats";
import { SERVER_SKIP_REASONS } from "./skip-reasons";

const PILOT_CAMPAIGN = { createdBy: "pilot" } as const;

/** Pilot state, instructions, and the stats and liveness reads. */
@singleton()
export class PilotService {
  constructor(private readonly prisma: PrismaClient) {}

  private async toState(row: PilotStateModel): Promise<PilotState> {
    const config = pilotInstructionsConfigSchema.parse(row.instructionsConfig);
    const now = new Date();
    const appliedToday = await countAppliedToday(this.prisma, row.userId, now);
    return {
      userId: row.userId,
      running: row.running,
      instructionsGoals: row.instructionsGoals,
      instructionsConfig: config,
      instructionsUpdatedAt: row.instructionsUpdatedAt,
      lastCycleAt: row.lastCycleAt,
      cycleCount: row.cycleCount,
      appliedToday,
      // `>=` so a cap of 0 reads as reached, matching the agenda.
      capReached: appliedToday >= config.dailyApplyCap,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Every state write publishes, so the web and the terminal see the same row. */
  private async publishState(row: PilotStateModel) {
    const state = await this.toState(row);
    publish(pilotChannel, { userId: row.userId }, { type: "state.changed", state });
    return state;
  }

  private async readGoals(userId: string): Promise<string> {
    const row = await this.prisma.pilotState.findUnique({
      where: { userId },
      select: { instructionsGoals: true },
    });
    return row?.instructionsGoals ?? "";
  }

  /** Every profile has exactly one state row, created with defaults on first read. */
  async getState(userId: string) {
    const row = await this.prisma.pilotState.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return this.toState(row);
  }

  async instructionsImpact(userId: string): Promise<PilotInstructionsImpact> {
    const [searches, campaigns, approved] = await Promise.all([
      this.prisma.pilotSearch.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { id: true, query: true, reason: true },
      }),
      this.prisma.campaign.findMany({
        where: { userId, ...PILOT_CAMPAIGN, status: "in_progress" },
        orderBy: { startedAt: "asc" },
        select: {
          campaignId: true,
          query: true,
          _count: { select: { jobs: { where: { status: "approved" } } } },
        },
      }),
      this.prisma.job.aggregate({
        where: { status: "approved", campaign: { userId, ...PILOT_CAMPAIGN } },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
    ]);
    return {
      searches,
      campaigns: campaigns.map(({ _count, ...campaign }) => ({
        ...campaign,
        approvedJobs: _count.jobs,
      })),
      approvedJobs: approved._count._all,
      oldestApprovedAt: approved._min.createdAt,
    };
  }

  async updateInstructions(userId: string, body: UpdatePilotInstructionsInput) {
    const goalsChanged = (await this.readGoals(userId)) !== body.goals;
    const instructions = {
      instructionsGoals: body.goals,
      instructionsConfig: body.config,
      instructionsUpdatedAt: new Date(),
      ...AGENDA_SNAPSHOT_RESET,
    };
    const row = await this.prisma.pilotState.upsert({
      where: { userId },
      create: { userId, ...instructions },
      update: instructions,
    });
    // Searches picked for the old goals all come due now, unless they are about to be deleted.
    if (goalsChanged && !body.onChange.rederiveSearches) {
      await this.prisma.pilotSearch.updateMany({
        where: { userId },
        data: { emptyRuns: 0, nextRunAt: new Date() },
      });
    }
    await this.retire(userId, body.onChange);
    return this.publishState(row);
  }

  /** Retires what the user chose to leave behind with the old goals. */
  private async retire(userId: string, change: PilotInstructionsChange) {
    const writes = [];
    if (change.rederiveSearches) {
      writes.push(
        this.prisma.pilotSearch.deleteMany({ where: { userId } }),
        // Bootstrap's damper would otherwise hold the re-derive back for a day.
        this.prisma.pilotClaim.deleteMany({ where: { userId, kind: "strategy.bootstrap" } }),
      );
    }
    if (change.dropApprovedJobs) {
      writes.push(
        this.prisma.job.updateMany({
          where: { status: "approved", campaign: { userId, ...PILOT_CAMPAIGN } },
          data: { status: "skipped", skipReason: SERVER_SKIP_REASONS.goalsChanged },
        }),
      );
    }
    // Read first: updateMany returns no rows, and the campaign views need a status event per row.
    const completing = change.completeCampaigns
      ? await this.prisma.campaign.findMany({
          where: { userId, ...PILOT_CAMPAIGN, status: "in_progress" },
          select: { campaignId: true, source: true },
        })
      : [];
    if (completing.length > 0) {
      writes.push(
        this.prisma.campaign.updateMany({
          where: {
            campaignId: { in: completing.map((campaign) => campaign.campaignId) },
            status: "in_progress",
          },
          data: {
            status: "completed",
            statusActor: "user",
            statusReason: "Goals changed.",
            completedAt: new Date(),
          },
        }),
      );
    }
    if (writes.length > 0) await this.prisma.$transaction(writes);
    for (const campaign of completing) publishCampaignStatus(userId, campaign, "completed");
  }

  async start(userId: string) {
    if ((await this.readGoals(userId)).trim() === "") {
      throw conflict("Write the pilot's goals before starting it.");
    }
    return this.setRunning(userId, true);
  }

  stop(userId: string) {
    return this.setRunning(userId, false);
  }

  private async setRunning(userId: string, running: boolean) {
    const row = await this.prisma.pilotState.upsert({
      where: { userId },
      create: { userId, running },
      update: { running, ...AGENDA_SNAPSHOT_RESET },
    });
    return this.publishState(row);
  }

  /** Clears run history only; instructions, searches and the running flag survive. */
  async reset(userId: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.pilotJournalEntry.deleteMany({ where: { userId } });
      return tx.pilotState.upsert({
        where: { userId },
        create: { userId },
        update: { cycleCount: 0, lastCycleAt: null, ...AGENDA_SNAPSHOT_RESET },
      });
    });
    return this.publishState(row);
  }

  getTodayOutcomes(userId: string) {
    return countTodayOutcomes(this.prisma, userId, new Date());
  }

  async getCost(userId: string) {
    return { items: await costByKind(this.prisma, userId, new Date()) };
  }

  /** Newest server-side activity, so the terminal can tell a slow live cycle from a stuck one. */
  async getActivity(userId: string) {
    const { prisma } = this;
    const [claims, journal, campaign, job, lastCycle, state] = await Promise.all([
      prisma.pilotClaim.findMany({
        where: { userId, releasedAt: null },
        select: { grantedAt: true, heartbeatAt: true, expiresAt: true },
      }),
      prisma.pilotJournalEntry.aggregate({ where: { userId }, _max: { createdAt: true } }),
      prisma.campaign.aggregate({ where: { userId }, _max: { updatedAt: true } }),
      prisma.job.aggregate({ where: { campaign: { userId } }, _max: { updatedAt: true } }),
      prisma.pilotJournalEntry.findFirst({
        where: { userId, kind: "cycle" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { cycleId: true, createdAt: true, detail: true },
      }),
      prisma.pilotState.findUnique({ where: { userId }, select: { running: true } }),
    ]);

    const times = [
      ...claims.flatMap((claim) => [claim.grantedAt, claim.heartbeatAt]),
      journal._max.createdAt,
      campaign._max.updatedAt,
      job._max.updatedAt,
    ].filter((time) => time != null);
    const now = new Date();
    // Stuck-recovery cycles journal an empty detail, and the host still needs their completedAt.
    const detail = lastCycle ? pilotCycleDetailSchema.safeParse(lastCycle.detail).data : undefined;

    return {
      lastActivityAt: times.reduce<Date | null>(
        (max, time) => (!max || time > max ? time : max),
        null,
      ),
      // An expired claim nobody has swept yet still counts as activity, but not as active.
      activeClaims: claims.filter((claim) => claim.expiresAt > now).length,
      running: state?.running ?? false,
      lastCycle: lastCycle && {
        cycleId: lastCycle.cycleId,
        completedAt: lastCycle.createdAt,
        status: detail?.status ?? null,
        sleepSeconds: detail?.sleepSeconds ?? null,
      },
    };
  }
}
