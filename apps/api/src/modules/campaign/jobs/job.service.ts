import type {
  AddCampaignJobInput,
  CampaignJobResultInput,
  PatchCampaignJobInput,
  RescanCampaignJobInput,
  RetryCampaignJobInput,
} from "@openapply/contracts/campaign";
import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { workspaceChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { conflict, findOwned } from "@/common/errors";
import { publish } from "@/common/sse";
import {
  type CampaignJobStatus,
  type CampaignSource,
  type Job,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { SubmissionService } from "@/modules/application/submission.service";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import {
  assertApplicationAllowed,
  companyExcluded,
  intakeDecisionPending,
} from "@/modules/application-rules/application-rules.guard";
import { allowedApplyUrl, assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import { JobListingPublisher } from "@/modules/job-listing";
import { candidateKey, lockDiscovery } from "@/modules/job-sources/candidate-intake";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { deriveCampaignSummary } from "../campaign.summary";
import { ensureCampaignOwned, PROMOTABLE_SOURCES } from "../campaign.utils";
import { assertNotDuplicateApply, guardApply } from "./apply-guard";
import {
  assertDiscoveryReady,
  discoveryBlockedReason,
  listRulesApply,
  reserveDiscoveryApplication,
} from "./discovery-guard";
import { assertCurrentFit } from "./fit-guard";
import { fitInvalidation } from "./fit-invalidation";
import { publishJob, publishProgress, publishStatusChange } from "./job-events";
import { isTerminalJob, writeJobResult } from "./job-result";
import { jobView } from "./job-view";
import {
  assertNoSubmissionConflict,
  SUBMISSION_NOT_STARTED,
  SUBMISSION_RECOVERY_NOTE,
  submissionConflict,
} from "./submission-guard";

const ALLOWED_TRANSITIONS: Record<CampaignJobStatus, readonly CampaignJobStatus[]> = {
  // A score pass promotes a pasted link into the normal pipeline; nothing ever moves back to queued.
  queued: ["pending"],
  pending: ["approved", "needs_user"],
  approved: ["pending", "applying"],
  applying: ["approved", "needs_user"],
  needs_user: ["approved", "applying"],
  applied: [],
  failed: [],
  skipped: [],
};

interface JobTransition {
  from: CampaignJobStatus;
  /** A concurrent writer already landing here makes the command a no-op. */
  to: CampaignJobStatus;
  /** Status meaning the command already ran; null when a repeat must still write. */
  idempotentAt: CampaignJobStatus | null;
  requireAssessment?: boolean;
  data: Prisma.JobUpdateManyMutationInput;
  rejection: (status: CampaignJobStatus) => string;
}

interface TransitionResult {
  job: Job;
  changed: boolean;
}

export interface ScoredJobPromotion {
  key: string;
  matchScore: number;
  threshold: number;
}

@singleton()
export class CampaignJobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly listings: JobListingPublisher,
    private readonly submissionFiles: SubmissionService,
    private readonly scoring: ScoringService,
  ) {}

  async addJob(userId: string, campaignId: string, body: AddCampaignJobInput) {
    if (["approved", "applying"].includes(body.status ?? "")) assertAutomationAllowed(body.url);
    if (body.status === "applying")
      throw conflict("Create the job before claiming it for an application.");
    await ensureCampaignOwned(this.prisma, userId, campaignId);
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { campaignId } });
    const config = campaignConfigSchema.parse(campaign.config ?? {});
    if (config.discovery) {
      if (body.status && !["queued", "pending"].includes(body.status))
        throw conflict("New candidates must enter the list unapproved for scoring.");
      const job = await this.prisma.$transaction(async (tx) => {
        const { config } = await lockDiscovery(tx, userId, campaignId);
        const key = candidateKey(body.url);
        const existing = await tx.job.findUnique({
          where: { campaignId_key: { campaignId, key } },
        });
        if (existing) return existing;
        if ((await tx.job.count({ where: { campaignId } })) >= (config.maxJobs ?? 100))
          throw conflict("Candidate list reached its discovery limit.");
        const resolved = !!allowedApplyUrl(body.url);
        const job = await tx.job.create({
          data: {
            ...body,
            campaignId,
            key,
            url: canonicalizeJobUrl(body.url),
            status: body.description?.trim() && resolved ? "pending" : "queued",
            ...(!body.description?.trim() && {
              retryNotes:
                "The source returned no full job description; fetch the employer posting before scoring.",
            }),
            ...(!resolved && {
              retryNotes:
                "Employer application URL is unresolved; the source posting is retained for review.",
            }),
          },
        });
        await tx.campaign.update({
          where: { campaignId },
          data: {
            config: {
              ...config,
              discovery: {
                ...config.discovery!,
                sources: [
                  ...config.discovery!.sources,
                  {
                    source: `Agent intake: ${body.board ?? new URL(body.url).hostname}`,
                    fetched: 1,
                    saved: 1,
                    resolved: resolved ? 1 : 0,
                    requests: 0,
                    truncated: false,
                    checkedAt: new Date().toISOString(),
                  },
                ],
              },
            },
          },
        });
        return job;
      });
      this.listings.publishInBackground(job);
      publishJob(userId, job, "added");
      return jobView(job);
    }
    const job = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      if (body.status === "approved") {
        await assertNoSubmissionConflict(tx, userId, body);
        await assertApplicationAllowed(tx, userId, body);
      }
      return tx.job.create({ data: { ...body, campaignId, status: body.status ?? "pending" } });
    });

    this.listings.publishInBackground(job);
    publishJob(userId, job, "added");
    return jobView(job);
  }

  /** A field edit, moving the status too when the patch names a new one. Never idempotent. */
  async patchJob(userId: string, campaignId: string, key: string, patch: PatchCampaignJobInput) {
    const existing = await this.findJob(userId, campaignId, key);
    if (isTerminalJob(existing.status)) {
      throw conflict("Terminal jobs cannot be edited; use the retry or rescan command.");
    }
    if (["approved", "applying"].includes(patch.status ?? existing.status))
      assertAutomationAllowed(existing.url);
    const moveTo = patch.status && patch.status !== existing.status ? patch.status : null;
    if (moveTo && !ALLOWED_TRANSITIONS[existing.status].includes(moveTo)) {
      throw conflict(`Job cannot transition from ${existing.status} to ${moveTo}.`);
    }

    const { status: _, ...fields } = patch;
    const invalidated = fitInvalidation(existing, fields);
    if (
      (moveTo === "approved" || moveTo === "applying") &&
      existing.fitAssessment !== null &&
      invalidated.matchScore === null
    ) {
      throw conflict("Update the posting and rescore before approving or applying.");
    }
    const job = await guardApply(this.prisma, userId, () =>
      this.prisma.$transaction(async (tx) => {
        await lockWorkUser(tx, userId);
        const recoveryOnly = patch.status === "needs_user" && Object.keys(fields).length === 0;
        if (!recoveryOnly) await assertNoSubmissionConflict(tx, userId, existing);
        if (moveTo === "approved" || moveTo === "applying") {
          await assertApplicationAllowed(tx, userId, existing);
          const assessment = await assertCurrentFit(
            this.scoring,
            userId,
            existing,
            !!existing.campaign.config &&
              !!campaignConfigSchema.parse(existing.campaign.config).discovery,
            tx,
          );
          if (await listRulesApply(tx, userId, existing.id))
            assertDiscoveryReady(existing.campaign.config, assessment);
        }
        if (moveTo === "applying") {
          await reserveDiscoveryApplication(tx, userId, existing, existing.campaign.config);
          await assertNotDuplicateApply(tx, userId, existing);
        }
        const changed = await tx.job.updateMany({
          where: {
            campaignId,
            key,
            status: existing.status,
            updatedAt: existing.updatedAt,
            ...(!recoveryOnly && { AND: [SUBMISSION_NOT_STARTED] }),
          },
          data: {
            ...fields,
            ...invalidated,
            ...(moveTo && { status: moveTo }),
            ...(moveTo === "approved" && { appliedAt: null, failReason: null, skipReason: null }),
          },
        });
        if (changed.count === 0) throw conflict("Job changed concurrently; reload before editing.");
        return tx.job.findUniqueOrThrow({ where: { campaignId_key: { campaignId, key } } });
      }),
    );

    this.listings.publishInBackground(job);
    if (moveTo) {
      await publishStatusChange(this.prisma, userId, job, existing.campaign.source);
    } else {
      publishJob(userId, job, "updated");
    }
    return jobView(job);
  }

  /** The only way out of `failed`. */
  async retryJob(userId: string, campaignId: string, key: string, body: RetryCampaignJobInput) {
    const { job } = await this.applyTransition(userId, campaignId, key, {
      from: "failed",
      to: "approved",
      idempotentAt: "approved",
      data: {
        status: "approved",
        appliedAt: null,
        failReason: null,
        skipReason: null,
        retryNotes: body.retryNotes,
      },
      rejection: (status) => `Only failed jobs can be retried; job is ${status}.`,
    });
    return jobView(job);
  }

  async rescanJob(userId: string, campaignId: string, key: string, body: RescanCampaignJobInput) {
    if ("action" in body) {
      const existing = await this.findJob(userId, campaignId, key);
      if (existing.status !== "skipped")
        throw conflict("Only skipped jobs can refresh a rescan posting.");
      const { action: _, ...fields } = body;
      const job = await this.prisma.$transaction(async (tx) => {
        await lockWorkUser(tx, userId);
        await assertNoSubmissionConflict(tx, userId, existing);
        const changed = await tx.job.updateMany({
          where: {
            campaignId,
            key,
            status: "skipped",
            updatedAt: existing.updatedAt,
            campaign: { userId },
            AND: [SUBMISSION_NOT_STARTED],
          },
          data: { ...fields, ...fitInvalidation(existing, fields) },
        });
        if (changed.count === 0)
          throw conflict("Job changed concurrently; reload before refreshing.");
        return tx.job.findUniqueOrThrow({ where: { campaignId_key: { campaignId, key } } });
      });
      this.listings.publishInBackground(job);
      publishJob(userId, job, "updated");
      return jobView(job);
    }
    const { job, changed } = await this.applyTransition(userId, campaignId, key, {
      from: "skipped",
      to: body.decision,
      // A still-skipped decision may update its reason; an approved repeat is a no-op.
      idempotentAt: body.decision === "approved" ? "approved" : null,
      requireAssessment: body.decision === "approved",
      data: {
        status: body.decision,
        skipReason: body.decision === "skipped" ? body.skipReason : null,
      },
      rejection: (status) => `Only skipped jobs can be rescanned; job is ${status}.`,
    });
    if (changed) {
      this.listings.publishInBackground(job);
    }
    return jobView(job);
  }

  /** Settles scored `pending` rows into `approved` or `skipped` by the campaign's threshold. */
  async promoteScoredJobs(
    userId: string,
    campaignId: string,
    source: CampaignSource,
    candidates: ScoredJobPromotion[],
  ): Promise<void> {
    const rows = await this.prisma.job.findMany({
      where: {
        campaignId,
        status: "pending",
        key: { in: candidates.map((candidate) => candidate.key) },
        campaign: { userId, status: "in_progress", source: { in: PROMOTABLE_SOURCES } },
        AND: [SUBMISSION_NOT_STARTED],
      },
      include: { campaign: { select: { config: true } } },
    });
    const jobs: Job[] = [];
    for (const row of rows) {
      const candidate = candidates.find((entry) => entry.key === row.key);
      if (!candidate) continue;
      const updated = await this.prisma.$transaction(async (tx) => {
        await lockWorkUser(tx, userId);
        if (
          row.intakeDecisionRequired ||
          (await intakeDecisionPending(tx, userId, row.url)) ||
          (await companyExcluded(tx, userId, row.company))
        )
          return [];
        const attempt = await findSubmissionAttempt(tx, userId, { jobId: row.id, url: row.url });
        if (submissionConflict(attempt, row.id)) {
          return tx.job.updateManyAndReturn({
            where: { id: row.id, status: "pending", updatedAt: row.updatedAt },
            data: { status: "needs_user", retryNotes: SUBMISSION_RECOVERY_NOTE },
          });
        }
        const assessment = await this.scoring.currentAssessment(
          userId,
          { campaignId, jobKey: row.key },
          tx,
        );
        if (
          row.campaign?.config &&
          campaignConfigSchema.parse(row.campaign.config).discovery &&
          discoveryBlockedReason(row.campaign.config, assessment)
        )
          return [];
        const where: Prisma.JobWhereInput = {
          id: row.id,
          status: "pending",
          updatedAt: row.updatedAt,
          campaign: { userId, status: "in_progress", source: { in: PROMOTABLE_SOURCES } },
          AND: [SUBMISSION_NOT_STARTED],
        };
        if (!assessment) {
          return tx.job.updateManyAndReturn({
            where,
            data: { fitAssessment: Prisma.DbNull, matchScore: null, matchReason: null },
          });
        }
        const outside = assessment.roleMatch.relevance === "outside_preferences";
        if (
          assessment.roleMatch.family === "Unclear" ||
          assessment.roleMatch.relevance === "unclear"
        )
          return [];
        const approved = !outside && assessment.score >= candidate.threshold;
        if (approved) assertAutomationAllowed(row.url);
        const skipReason = outside
          ? "Outside saved desired roles"
          : `Below minimum match score (${assessment.score} < ${candidate.threshold})`;
        return tx.job.updateManyAndReturn({
          where: { ...where, matchScore: assessment.score },
          data: approved ? { status: "approved" } : { status: "skipped", skipReason },
        });
      });
      jobs.push(...updated);
    }
    if (jobs.length === 0) return;

    for (const job of jobs) {
      publishJob(userId, job, "updated");
    }
    await publishProgress(this.prisma, campaignId, source);
  }

  async recordJobResult(
    userId: string,
    campaignId: string,
    key: string,
    data: CampaignJobResultInput,
  ) {
    const result = await writeJobResult(
      this.prisma,
      userId,
      campaignId,
      key,
      data,
      this.submissionFiles,
    );
    const summary = result.changed
      ? await publishStatusChange(this.prisma, userId, result.campaignJob, result.source)
      : await deriveCampaignSummary(this.prisma, campaignId, result.source);
    if (result.changed && result.application) {
      publish(workspaceChannel, { userId }, { type: "application.created", campaignId });
    }
    return { campaignJob: jobView(result.campaignJob), application: result.application, summary };
  }

  private findJob(userId: string, campaignId: string, key: string) {
    return findOwned(
      (where) =>
        this.prisma.job.findFirst({
          where,
          include: { campaign: { select: { source: true, config: true } } },
        }),
      { campaignId, key, campaign: { userId } },
      "Campaign job",
    );
  }

  /** A guarded status transition that absorbs repeat commands and lost races as no-ops. */
  private async applyTransition(
    userId: string,
    campaignId: string,
    key: string,
    transition: JobTransition,
  ): Promise<TransitionResult> {
    const existing = await this.findJob(userId, campaignId, key);
    if (["approved", "applying"].includes(transition.to)) {
      assertAutomationAllowed(existing.url);
    }
    await assertNoSubmissionConflict(this.prisma, userId, existing);
    if (existing.status === transition.idempotentAt) {
      return { job: existing, changed: false };
    }
    if (existing.status !== transition.from) {
      throw conflict(transition.rejection(existing.status));
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertNoSubmissionConflict(tx, userId, existing);
      if (["approved", "applying"].includes(transition.to)) {
        await assertApplicationAllowed(tx, userId, existing);
        const assessment = await assertCurrentFit(
          this.scoring,
          userId,
          existing,
          transition.requireAssessment ||
            (!!existing.campaign.config &&
              !!campaignConfigSchema.parse(existing.campaign.config).discovery),
          tx,
        );
        if (await listRulesApply(tx, userId, existing.id))
          assertDiscoveryReady(existing.campaign.config, assessment);
      }
      const changed = await tx.job.updateMany({
        where: {
          campaignId,
          key,
          status: transition.from,
          updatedAt: existing.updatedAt,
          campaign: { userId },
          AND: [SUBMISSION_NOT_STARTED],
        },
        data: transition.data,
      });
      const job = await tx.job.findUniqueOrThrow({
        where: { campaignId_key: { campaignId, key } },
      });
      if (changed.count === 0) {
        if (job.status === transition.to) return { job, changed: false };
        throw conflict(`Job changed concurrently to ${job.status}.`);
      }

      return { job, changed: true };
    });
    if (result.changed)
      await publishStatusChange(this.prisma, userId, result.job, existing.campaign.source);
    return result;
  }
}
