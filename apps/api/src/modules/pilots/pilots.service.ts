import { pageSlice, paginate } from "@openapply/contracts/pagination";
import {
  type PilotInput,
  type PilotRules,
  type pilotResultActionSchema,
  type pilotResultsQuerySchema,
  pilotRulesSchema,
} from "@openapply/contracts/pilots";
import { workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { conflict, findOwned, HttpError } from "@/common/errors";
import { logger } from "@/common/logger";
import { publish } from "@/common/sse";
import { type Pilot, type PilotRun, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { enqueueApplications, lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { TERMINAL_WORK_STATES } from "@/modules/work-queue/work-queue.policy";
import { WorkQueueService } from "@/modules/work-queue/work-queue.service";
import { rulesWhere, settledStatus, windowFor, windowWhere } from "./pilots.rules";

type ResultAction = z.infer<typeof pilotResultActionSchema>;
type ResultsQuery = z.infer<typeof pilotResultsQuerySchema>;

const MINUTE_MS = 60_000;
/** Listings read per run for every job kept; some have no usable employer link. */
const OVERSCAN = 3;

function changed(userId: string): void {
  publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
}

@singleton()
export class PilotsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: WorkQueueService,
  ) {}

  private owned(userId: string, id: string) {
    return findOwned((where) => this.prisma.pilot.findFirst({ where }), { id, userId }, "Pilot");
  }

  private nextRun(autoRun: boolean, intervalMinutes: number, from = new Date()): Date | null {
    return autoRun ? new Date(from.getTime() + intervalMinutes * MINUTE_MS) : null;
  }

  private async view(pilot: Pilot) {
    const [lastRun, counts, resume] = await Promise.all([
      this.prisma.pilotRun.findFirst({
        where: { pilotId: pilot.id },
        orderBy: { startedAt: "desc" },
      }),
      this.prisma.pilotResult.groupBy({
        by: ["status"],
        where: { pilotId: pilot.id },
        _count: true,
      }),
      this.prisma.resume.findFirst({
        where: { id: pilot.resumeId, userId: pilot.userId },
        select: { label: true },
      }),
    ]);
    const count = (status: string) => counts.find((row) => row.status === status)?._count ?? 0;
    return {
      ...pilot,
      rules: pilotRulesSchema.parse(pilot.rules),
      resumeLabel: resume?.label ?? null,
      counts: {
        review: count("review"),
        added: count("added"),
        removed: count("removed"),
        belowFit: count("below_fit"),
      },
      lastRun: lastRun ? await this.runView(lastRun) : null,
    };
  }

  private async runView(run: PilotRun) {
    const scored = await this.prisma.pilotResult.count({
      where: { runId: run.id, status: { not: "scoring" } },
    });
    return { ...run, scored };
  }

  async list(userId: string) {
    await this.settleActive(userId);
    const pilots = await this.prisma.pilot.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(pilots.map((pilot) => this.view(pilot)));
  }

  async detail(userId: string, id: string) {
    await this.settleActive(userId, id);
    return this.view(await this.owned(userId, id));
  }

  async create(userId: string, input: PilotInput) {
    await findOwned(
      (where) => this.prisma.resume.findFirst({ where }),
      { id: input.resumeId, userId },
      "Resume",
    );
    const pilot = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          userId,
          query: input.name,
          source: "search",
          config: { resumeId: input.resumeId, minScore: input.minScore },
        },
      });
      return tx.pilot.create({
        data: {
          ...input,
          userId,
          campaignId: campaign.campaignId,
          nextRunAt: this.nextRun(input.autoRun, input.intervalMinutes),
        },
      });
    });
    return this.view(pilot);
  }

  async update(userId: string, id: string, input: Partial<PilotInput>) {
    const pilot = await this.owned(userId, id);
    if (input.resumeId)
      await findOwned(
        (where) => this.prisma.resume.findFirst({ where }),
        { id: input.resumeId, userId },
        "Resume",
      );
    const autoRun = input.autoRun ?? pilot.autoRun;
    const intervalMinutes = input.intervalMinutes ?? pilot.intervalMinutes;
    const scheduleChanged = autoRun !== pilot.autoRun || intervalMinutes !== pilot.intervalMinutes;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.resumeId || input.minScore !== undefined || input.name)
        await tx.campaign.update({
          where: { campaignId: pilot.campaignId },
          data: {
            ...(input.name && { query: input.name }),
            config: {
              resumeId: input.resumeId ?? pilot.resumeId,
              minScore: input.minScore ?? pilot.minScore,
            },
          },
        });
      return tx.pilot.update({
        where: { id },
        data: {
          ...input,
          ...(scheduleChanged && { nextRunAt: this.nextRun(autoRun, intervalMinutes) }),
        },
      });
    });
    return this.view(updated);
  }

  async remove(userId: string, id: string) {
    const pilot = await this.owned(userId, id);
    await this.stop(userId, id).catch(() => undefined);
    await this.prisma.$transaction([
      this.prisma.pilot.delete({ where: { id } }),
      // Jobs already added keep their queue items, so the campaign stays and is closed.
      this.prisma.campaign.update({
        where: { campaignId: pilot.campaignId },
        data: { status: "completed", completedAt: new Date() },
      }),
    ]);
    return { id };
  }

  async preview(userId: string, rules: PilotRules) {
    const now = new Date();
    const windows = rules.postedWithin.length
      ? [...rules.postedWithin].sort((a, b) => a - b)
      : [null];
    const counts = await Promise.all(
      windows.map((minutes) =>
        this.prisma.jobListing.count({
          where: rulesWhere({ ...rules, postedWithin: minutes ? [minutes] : [] }, userId, now),
        }),
      ),
    );
    return { windows: windows.map((minutes, index) => ({ minutes, count: counts[index] ?? 0 })) };
  }

  /** One run: filter the index on the server, then hand only the new jobs to the agent. */
  async run(userId: string, id: string, trigger: "manual" | "schedule") {
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockWorkUser(tx, userId);
        const pilot = await findOwned(
          (where) => tx.pilot.findFirst({ where }),
          { id, userId },
          "Pilot",
        );
        if (await tx.pilotRun.findFirst({ where: { pilotId: id, state: "scoring" } }))
          throw conflict("This pilot is already looking for jobs.");
        const rules = pilotRulesSchema.parse(pilot.rules);
        const where: Prisma.JobListingWhereInput = {
          ...rulesWhere(rules, userId, now),
          pilotResults: { none: { pilotId: id } },
        };
        const [scanned, matched, listings] = await Promise.all([
          tx.jobListing.count({ where: windowWhere(rules, userId, now) }),
          tx.jobListing.count({ where }),
          tx.jobListing.findMany({
            where,
            orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }],
            take: pilot.maxJobsPerRun * OVERSCAN,
            select: {
              id: true,
              title: true,
              company: true,
              location: true,
              postedAt: true,
              firstSeenAt: true,
              descriptionExcerpt: true,
              // The highest-ranked source's apply link is the listing's; see source-rank.ts.
              sources: {
                select: { applyUrl: true, url: true },
                orderBy: [{ rank: "desc" }, { lastSeenAt: "desc" }],
              },
            },
          }),
        ]);
        const run = await tx.pilotRun.create({
          data: { pilotId: id, trigger, scanned, matched },
        });
        const picked: { listing: (typeof listings)[number]; url: string }[] = [];
        const seen = new Set<string>();
        for (const listing of listings) {
          if (picked.length >= pilot.maxJobsPerRun) break;
          const link = listing.sources
            .map((source) => allowedApplyUrl(source.applyUrl) ?? allowedApplyUrl(source.url))
            .find(Boolean);
          if (!link) continue;
          const url = canonicalizeJobUrl(link);
          if (seen.has(url)) continue;
          seen.add(url);
          const [applied, existing] = await Promise.all([
            tx.application.findUnique({
              where: { userId_url: { userId, url } },
              select: { id: true },
            }),
            tx.job.findFirst({ where: { campaign: { userId }, url }, select: { id: true } }),
          ]);
          if (applied || existing) continue;
          picked.push({ listing, url });
        }
        const jobs = picked.length
          ? await tx.job.createManyAndReturn({
              data: picked.map(({ listing, url }) => ({
                campaignId: pilot.campaignId,
                key: crypto.randomUUID(),
                title: listing.title,
                company: listing.company,
                location: listing.location,
                url,
                board: new URL(url).hostname,
                description: listing.descriptionExcerpt,
              })),
            })
          : [];
        await tx.pilotResult.createMany({
          data: picked.map(({ listing }, index) => {
            const posted = listing.postedAt ?? listing.firstSeenAt;
            return {
              pilotId: id,
              runId: run.id,
              listingId: listing.id,
              jobId: jobs[index]!.id,
              postedAt: posted,
              windowMinutes: windowFor(posted, rules.postedWithin, now),
            };
          }),
        });
        let workItemId: string | null = null;
        if (jobs.length) {
          const item = await tx.workItem.create({
            data: {
              userId,
              kind: "pilot_task",
              source: "discovery",
              provider: pilot.provider,
              identity: `pilot-run:${run.id}`,
              campaignId: pilot.campaignId,
              intent: "pilot_score",
              title: `Score ${jobs.length} jobs for ${pilot.name}`,
              payload: {
                pilotId: id,
                runId: run.id,
                jobIds: jobs.map((job) => job.id),
                resumeId: pilot.resumeId,
                minScore: pilot.minScore,
              },
            },
          });
          workItemId = item.id;
        }
        const saved = await tx.pilotRun.update({
          where: { id: run.id },
          data: jobs.length
            ? { workItemId }
            : { state: "done", finishedAt: new Date(), reason: "No new jobs matched." },
        });
        if (trigger === "schedule" || pilot.autoRun)
          await tx.pilot.update({
            where: { id },
            data: { nextRunAt: this.nextRun(pilot.autoRun, pilot.intervalMinutes, now) },
          });
        return { run: saved, queued: jobs.length > 0 };
      },
      { timeout: 30_000 },
    );
    if (result.queued) changed(userId);
    return this.runView(result.run);
  }

  async stop(userId: string, id: string) {
    await this.owned(userId, id);
    const run = await this.prisma.pilotRun.findFirst({ where: { pilotId: id, state: "scoring" } });
    if (!run) throw conflict("This pilot isn't running.");
    if (run.workItemId)
      await this.queue.control(userId, run.workItemId, "stop").catch((error: unknown) => {
        // The item may already have finished; settling below handles both cases.
        if (!(error instanceof HttpError)) throw error;
      });
    return this.runView(await this.settleRun(run, "stopped"));
  }

  /** Moves scored results out of `scoring` and closes the run once its scoring task ends. */
  private async settleRun(run: PilotRun, force?: "stopped") {
    const [pilot, results, item] = await Promise.all([
      this.prisma.pilot.findUniqueOrThrow({ where: { id: run.pilotId } }),
      this.prisma.pilotResult.findMany({
        where: { runId: run.id, status: "scoring" },
        select: { id: true, job: { select: { matchScore: true, fitAssessment: true } } },
      }),
      run.workItemId
        ? this.prisma.workItem.findUnique({
            where: { id: run.workItemId },
            select: { state: true },
          })
        : null,
    ]);
    const finished = !!force || !item || TERMINAL_WORK_STATES.includes(item.state);
    for (const result of results) {
      const score = result.job.fitAssessment ? result.job.matchScore : null;
      if (score === null && !finished) continue;
      await this.prisma.pilotResult.update({
        where: { id: result.id },
        data: { status: settledStatus(score, pilot.minScore) },
      });
    }
    if (!finished) return run;
    const closed = await this.prisma.pilotRun.update({
      where: { id: run.id },
      data: {
        state: force ?? (item?.state === "failed" ? "failed" : "done"),
        finishedAt: new Date(),
      },
    });
    if (run.trigger === "schedule" && pilot.mode === "queue" && !force) {
      await this.addToQueue(pilot, { runId: run.id, status: "review" }).catch((error: unknown) =>
        logger.error({ err: error, pilotId: pilot.id }, "Pilot could not add matches to queue"),
      );
    }
    return closed;
  }

  private async settleActive(userId?: string, pilotId?: string) {
    const runs = await this.prisma.pilotRun.findMany({
      where: {
        state: "scoring",
        ...(pilotId && { pilotId }),
        ...(userId && { pilot: { userId } }),
      },
    });
    for (const run of runs) await this.settleRun(run);
  }

  async results(userId: string, id: string, query: ResultsQuery) {
    await this.settleActive(userId, id);
    await this.owned(userId, id);
    const where: Prisma.PilotResultWhereInput = { pilotId: id, status: query.status };
    const [rows, total] = await Promise.all([
      this.prisma.pilotResult.findMany({
        where,
        ...pageSlice(query),
        orderBy:
          query.sort === "match"
            ? [{ job: { matchScore: { sort: "desc", nulls: "last" } } }, { id: "asc" }]
            : [{ postedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        include: {
          job: {
            select: { title: true, company: true, location: true, url: true, matchScore: true },
          },
          listing: { select: { level: true, workMode: true } },
        },
      }),
      this.prisma.pilotResult.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        windowMinutes: row.windowMinutes,
        postedAt: row.postedAt,
        foundAt: row.createdAt,
        ...row.job,
        level: row.listing.level,
        workMode: row.listing.workMode,
      })),
      query,
      total,
    );
  }

  /** Admits each job through the normal queue, so every queue rule still applies per job. */
  private async addToQueue(pilot: Pilot, where: Prisma.PilotResultWhereInput) {
    const targets = await this.prisma.pilotResult.findMany({
      where: { ...where, pilotId: pilot.id, status: "review" },
      select: { id: true, jobId: true },
    });
    const skipped: { resultId: string; reason: string }[] = [];
    let updated = 0;
    for (const target of targets) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await lockWorkUser(tx, pilot.userId);
          await tx.job.updateMany({
            where: { id: target.jobId, status: "pending" },
            data: { status: "approved" },
          });
          await enqueueApplications(tx, pilot.userId, {
            idempotencyKey: crypto.randomUUID(),
            jobIds: [target.jobId],
            source: "discovery",
            provider: pilot.provider,
          });
          await tx.pilotResult.update({ where: { id: target.id }, data: { status: "added" } });
        });
        updated++;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        skipped.push({ resultId: target.id, reason: error.message });
      }
    }
    if (updated) changed(pilot.userId);
    return { updated, skipped };
  }

  async queueResults(userId: string, id: string, input: ResultAction) {
    const pilot = await this.owned(userId, id);
    return this.addToQueue(pilot, input.all ? {} : { id: { in: input.resultIds ?? [] } });
  }

  async removeResults(userId: string, id: string, input: ResultAction) {
    await this.owned(userId, id);
    const { count } = await this.prisma.pilotResult.updateMany({
      where: {
        pilotId: id,
        status: "review",
        ...(!input.all && { id: { in: input.resultIds ?? [] } }),
      },
      data: { status: "removed" },
    });
    return { updated: count, skipped: [] };
  }

  /** Starts every due scheduled pilot and settles runs whose scoring has finished. */
  async tick() {
    const due = await this.prisma.pilot.findMany({
      where: { autoRun: true, nextRunAt: { lte: new Date() } },
      select: { id: true, userId: true, intervalMinutes: true },
    });
    for (const pilot of due) {
      try {
        await this.run(pilot.userId, pilot.id, "schedule");
      } catch (error) {
        // A run still scoring skips this slot instead of stacking another behind it.
        await this.prisma.pilot.update({
          where: { id: pilot.id },
          data: { nextRunAt: this.nextRun(true, pilot.intervalMinutes) },
        });
        if (!(error instanceof HttpError))
          logger.error({ err: error, pilotId: pilot.id }, "Pilot run failed");
      }
    }
    await this.settleActive();
  }
}
