import { randomUUID } from "node:crypto";
import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { needsYouChannel } from "@openapply/contracts/sse";
import {
  type SubmissionCheckpointInput,
  type SubmissionReceiptInput,
  type SubmissionWorkerResult,
  submissionCheckpointInputSchema,
  submissionCheckpointSchema,
  submissionReceiptInputSchema,
  submissionWorkerResultSchema,
} from "@openapply/contracts/submission";
import { singleton } from "tsyringe";
import { sha256 } from "@/common/crypto/hash";
import { conflict, findOwned, notFound, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSelectedDocuments } from "@/modules/application-question/document.store";
import {
  assertDiscoveryReady,
  listRulesApply,
  reserveDiscoveryApplication,
} from "@/modules/campaign/jobs/discovery-guard";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import {
  consumeCheckpointApproval,
  requireCheckpointApproval,
} from "@/modules/pilot/checkpoint-approval.service";
import { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { assertSubmissionLease } from "@/modules/work-queue/submission-fence";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { findAppliedDuplicate } from "./duplicate";
import { canonicalizeJobUrl } from "./job-url";
import { SubmissionService } from "./submission.service";
import { findSubmissionAttempt, submissionAttemptView } from "./submission-attempt-state";

const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;
const hash = (value: unknown) => sha256(JSON.stringify(value));

@singleton()
export class SubmissionAttemptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly files: SubmissionService,
    private readonly artifacts: ResumeArtifactService,
    private readonly scoring: ScoringService,
  ) {}

  private job(userId: string, campaignId: string, key: string) {
    return findOwned(
      (where) =>
        this.prisma.job.findFirst({ where, include: { campaign: { select: { source: true } } } }),
      { campaignId, key, campaign: { userId } },
      "Campaign job",
    );
  }

  async read(userId: string, campaignId: string, key: string) {
    const job = await this.job(userId, campaignId, key);
    const attempt = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    return { attempt: attempt && submissionAttemptView(attempt) };
  }

  async checkpoint(
    userId: string,
    campaignId: string,
    key: string,
    raw: SubmissionCheckpointInput,
  ) {
    const input = submissionCheckpointInputSchema.parse(raw);
    const job = await this.job(userId, campaignId, key);
    if (job.status !== "applying")
      throw conflict("Only an applying job can prepare a submission checkpoint.");
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertSelectedDocuments(tx, this.artifacts, userId, job.id, input);
    });
    await this.files.verifyResume(userId, job.id, input.resume);
    await findOwned(
      (where) => this.prisma.resume.findFirst({ where, select: { id: true } }),
      { id: input.resumeId, userId },
      "Submitted base resume",
    );
    if (input.resumeVariantId) {
      const variant = await findOwned(
        (where) => this.prisma.resumeVariant.findFirst({ where, select: { resumeId: true } }),
        { id: input.resumeVariantId, resume: { userId } },
        "Submitted resume variant",
      );
      if (variant.resumeId !== input.resumeId)
        throw unprocessable("Submitted variant does not belong to the selected base resume.");
    }
    if (input.resume.artifact) {
      const reference = input.resume.artifact;
      if (reference.resumeId !== input.resumeId || reference.variantId !== input.resumeVariantId)
        throw unprocessable("Reviewed artifact does not identify the selected resume and variant.");
      const artifact = await this.artifacts.get(
        userId,
        reference.resumeId,
        reference.variantId,
        reference.revision,
      );
      if (artifact.pdfSha256 !== input.resume.sha256)
        throw unprocessable("Retained PDF differs from the reviewed resume artifact.");
    }
    const { expectedCheckpointId, ...payload } = input;
    const canonicalUrl = canonicalizeJobUrl(job.url);
    const checkpoint = submissionCheckpointSchema.parse({
      ...payload,
      job: {
        id: job.id,
        campaignId,
        key,
        url: job.url,
        canonicalUrl,
        title: job.title,
        company: job.company,
        location: job.location,
        board: job.board,
        source: job.campaign.source,
        matchScore: job.matchScore,
        matchReason: job.matchReason,
        updatedAt: job.updatedAt.toISOString(),
      },
    });
    const checkpointHash = hash(checkpoint);
    const existing = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    if (existing) {
      if (
        existing.jobId !== job.id ||
        existing.legacyOutcomeUnknown ||
        existing.startedAt ||
        existing.canonicalUrl !== canonicalUrl
      )
        throw conflict(
          "This posting has an existing submission reservation; inspect its outcome before any further Submit.",
        );
      if (existing.checkpointHash === checkpointHash) {
        await this.ensureHumanApproval(userId, job.id, existing.id);
        return { attempt: submissionAttemptView(existing) };
      }
      if (existing.checkpointId !== expectedCheckpointId)
        throw conflict("The checkpoint changed; read it before replacing reviewed fields.");
      const updated = await this.prisma.submissionAttempt.updateMany({
        where: {
          id: existing.id,
          checkpointId: expectedCheckpointId,
          startedAt: null,
          legacyOutcomeUnknown: false,
        },
        data: { checkpointId: randomUUID(), checkpoint: toInputJson(checkpoint), checkpointHash },
      });
      if (!updated.count)
        throw conflict("Submission began or checkpoint changed; it cannot be replaced.");
    } else {
      if (expectedCheckpointId) throw conflict("The expected checkpoint does not exist.");
      if (await findAppliedDuplicate(this.prisma, userId, job))
        throw conflict("This profile already applied to this posting; do not submit again.");
      try {
        await this.prisma.submissionAttempt.create({
          data: {
            userId,
            jobId: job.id,
            originalUrl: job.url,
            canonicalUrl,
            checkpointId: randomUUID(),
            checkpoint: toInputJson(checkpoint),
            checkpointHash,
          },
        });
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "P2002")
          throw conflict(
            "Another worker reserved this posting. Read the existing submission attempt.",
          );
        throw error;
      }
    }
    const saved = await findSubmissionAttempt(this.prisma, userId, { jobId: job.id, url: job.url });
    if (saved) await this.ensureHumanApproval(userId, job.id, saved.id);
    publishJob(userId, job, "updated");
    return this.read(userId, campaignId, key);
  }

  private async ensureHumanApproval(userId: string, jobId: string, attemptId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const job = await tx.job.findFirst({ where: { id: jobId, campaign: { userId } } });
      if (!job) throw conflict("The job changed during approval preparation.");
      const attempt = await tx.submissionAttempt.findFirst({
        where: { id: attemptId, userId, jobId },
      });
      if (!attempt) throw conflict("The checkpoint changed during approval preparation.");
      await requireCheckpointApproval(tx, userId, job, attempt);
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
  }

  async begin(
    userId: string,
    campaignId: string,
    key: string,
    checkpointId: string,
    workItemId?: string,
    leaseToken?: string,
  ) {
    const job = await this.job(userId, campaignId, key);
    const attempt = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    if (
      !attempt ||
      attempt.jobId !== job.id ||
      attempt.checkpointId !== checkpointId ||
      attempt.legacyOutcomeUnknown
    )
      throw conflict("A current reviewed checkpoint is required before Submit.");
    if (attempt.startedAt) return { began: false, attempt: submissionAttemptView(attempt) };
    const checkpoint = submissionCheckpointSchema.parse(attempt.checkpoint);
    await this.files.verifyResume(userId, job.id, checkpoint.resume);
    const result = await this.prisma.$transaction(async (tx) => {
      const execution = await assertSubmissionLease(tx, userId, job.id, workItemId, leaseToken);
      await assertSelectedDocuments(tx, this.artifacts, userId, job.id, checkpoint);
      const currentJob = await findOwned(
        (where) => tx.job.findFirst({ where, include: { campaign: { select: { config: true } } } }),
        { id: job.id, campaignId, campaign: { userId } },
        "Campaign job",
      );
      const config = campaignConfigSchema.parse(currentJob.campaign.config);
      if (config.discovery && (await listRulesApply(tx, userId, currentJob.id))) {
        await reserveDiscoveryApplication(tx, userId, currentJob, currentJob.campaign.config);
        const assessment = await this.scoring.currentAssessment(
          userId,
          { campaignId, jobKey: key },
          tx,
        );
        assertDiscoveryReady(config, assessment);
        if (checkpoint.resumeId !== config.resumeId)
          throw conflict(
            "The reviewed PDF must use the original resume selected for this candidate list.",
          );
      }
      await consumeCheckpointApproval(tx, userId, currentJob, attempt);
      const now = new Date();
      const held = await tx.job.updateMany({
        where: {
          id: job.id,
          status: "applying",
          updatedAt: new Date(checkpoint.job.updatedAt),
          campaign: { userId, status: "in_progress" },
        },
        data: { updatedAt: now },
      });
      if (!held.count) {
        const current = await tx.submissionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (current.checkpointId === checkpointId && current.startedAt)
          return { began: false, attempt: submissionAttemptView(current) };
        throw conflict("Job changed after review. Prepare a fresh checkpoint before Submit.");
      }
      if (await findAppliedDuplicate(tx, userId, checkpoint.job))
        throw conflict("This profile already applied to this posting; do not submit again.");
      const changed = await tx.submissionAttempt.updateMany({
        where: { id: attempt.id, checkpointId, startedAt: null, legacyOutcomeUnknown: false },
        data: { startedAt: now },
      });
      const current = await tx.submissionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (current.checkpointId !== checkpointId)
        throw conflict("The reviewed checkpoint changed before Submit.");
      if (changed.count === 1)
        await tx.workExecution.update({
          where: { id: execution.id },
          data: { consumedAt: now, submissionAttemptId: attempt.id },
        });
      return { began: changed.count === 1, attempt: submissionAttemptView(current) };
    });
    publishJob(userId, await this.job(userId, campaignId, key), "updated");
    return result;
  }

  async receipt(userId: string, campaignId: string, key: string, raw: SubmissionReceiptInput) {
    const input = submissionReceiptInputSchema.parse(raw);
    const job = await this.job(userId, campaignId, key);
    const attempt = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    if (
      !attempt ||
      attempt.jobId !== job.id ||
      attempt.checkpointId !== input.checkpointId ||
      !attempt.startedAt ||
      attempt.legacyOutcomeUnknown
    )
      throw conflict("A begun checkpoint is required before storing a receipt.");
    const receiptHash = hash(input);
    if (attempt.receiptHash) {
      if (attempt.receiptHash !== receiptHash)
        throw conflict("A different receipt is already retained; it cannot be replaced.");
      return { attempt: submissionAttemptView(attempt) };
    }
    const observed = new Date(input.confirmation.observedAt).getTime();
    if (
      observed < attempt.startedAt.getTime() - CLOCK_TOLERANCE_MS ||
      observed > Date.now() + CLOCK_TOLERANCE_MS
    )
      throw unprocessable(
        "Confirmation time must follow this submission begin and cannot be in the future (two-minute clock tolerance).",
      );
    await this.prisma.submissionAttempt.updateMany({
      where: {
        id: attempt.id,
        checkpointId: input.checkpointId,
        receiptHash: null,
        startedAt: attempt.startedAt,
      },
      data: { receipt: toInputJson(input), receiptHash, receiptStoredAt: new Date() },
    });
    const current = await this.prisma.submissionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (current.receiptHash !== receiptHash)
      throw conflict("A different receipt was retained concurrently.");
    publishJob(userId, job, "updated");
    return { attempt: submissionAttemptView(current) };
  }

  async pdf(userId: string, campaignId: string, key: string, checkpointId: string) {
    const job = await this.job(userId, campaignId, key);
    const attempt = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    if (!attempt || attempt.checkpointId !== checkpointId || !attempt.checkpoint)
      throw notFound("Submission checkpoint");
    const checkpoint = submissionCheckpointSchema.parse(attempt.checkpoint);
    return this.files.checkpointPdf(userId, checkpoint.resume);
  }

  async checkWorkerResult(
    userId: string,
    campaignId: string,
    key: string,
    raw: SubmissionWorkerResult,
  ) {
    const input = submissionWorkerResultSchema.parse(raw);
    const job = await this.job(userId, campaignId, key);
    const attempt = await findSubmissionAttempt(this.prisma, userId, {
      jobId: job.id,
      url: job.url,
    });
    if (input.outcome === "recorded" || input.outcome === "recording_pending") {
      if (
        !attempt ||
        attempt.jobId !== job.id ||
        attempt.checkpointId !== input.checkpointId ||
        !attempt.startedAt ||
        attempt.legacyOutcomeUnknown
      )
        throw conflict("Worker result does not match a begun checkpoint for this job.");
      if (input.outcome === "recorded") {
        if (
          !attempt.recordedAt ||
          attempt.applicationId !== input.applicationId ||
          job.status !== "applied"
        )
          throw conflict("Worker result has no matching recorded application.");
        const application = await this.prisma.application.findFirst({
          where: { id: input.applicationId, userId, campaignId, url: attempt.canonicalUrl! },
        });
        if (!application)
          throw conflict("Worker result application is not owned or does not match this posting.");
      }
    }
    if (
      (input.outcome === "failed" || input.outcome === "skipped") &&
      attempt &&
      (attempt.startedAt ||
        attempt.legacyOutcomeUnknown ||
        attempt.receiptStoredAt ||
        attempt.recordedAt)
    )
      throw conflict(
        "An uncertain or recorded submission cannot be handed back as failed or skipped.",
      );
    return {
      valid: true as const,
      outcome: input.outcome,
      attempt: attempt && submissionAttemptView(attempt),
    };
  }
}
