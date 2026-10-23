import { campaignConfigSchema } from "@openapply/contracts/campaign";
import {
  type IntakeCreate,
  type IntakeDecision,
  type IntakePrepare,
  intakeCreateSchema,
  intakeDecisionSchema,
  intakePrepareSchema,
  jobIntakeSchema,
} from "@openapply/contracts/job-intake";
import { type PaginationQuery, pageSlice, paginate } from "@openapply/contracts/pagination";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { type JobIntake, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { companyExcluded } from "@/modules/application-rules/application-rules.guard";
import { assertDiscoveryReady } from "@/modules/campaign/jobs/discovery-guard";
import { assertCurrentFit } from "@/modules/campaign/jobs/fit-guard";
import { preparationSnapshot } from "@/modules/intake-preparation/preparation.snapshot";
import { assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import { candidateKey } from "@/modules/job-sources/candidate-intake";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { enqueueApplications, lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { workHash } from "@/modules/work-queue/work-queue.policy";
import { existingIntakeJob, hasIntakeApplication } from "./intake-history";
import { intakeUrl, resolveIntake } from "./intake-resolver";

async function view(
  tx: Prisma.TransactionClient,
  scoring: ScoringService,
  userId: string,
  row: JobIntake,
) {
  const job = row.jobId
    ? await tx.job.findFirst({
        where: { id: row.jobId, campaign: { userId } },
        include: { workItem: true },
      })
    : null;
  const collection = job
    ? await tx.jobQuestionCollection.findFirst({
        where: { userId, jobId: job.id },
        orderBy: { version: "desc" },
      })
    : null;
  const fit = job
    ? await scoring.currentAssessment(userId, { campaignId: job.campaignId, jobKey: job.key }, tx)
    : null;
  const unansweredCount = job
    ? await tx.applicationQuestion.count({
        where: { userId, jobId: job.id, current: true, blocking: true },
      })
    : 0;
  const prepared = row.resolved && !!job?.description?.trim() && !!fit;
  const preparationWork =
    !job?.workItem && row.jobId
      ? await tx.workItem.findFirst({
          where: {
            userId,
            intent: "intake_prepare",
            payload: { path: ["intakeId"], equals: row.id },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : null;
  let preparation = "unresolved";
  if (!job) preparation = "already_applied";
  else if (prepared) preparation = "ready";
  else if (row.resolved && job.description?.trim()) preparation = "pending";
  return jobIntakeSchema.parse({
    id: row.id,
    revision: row.revision,
    url: row.originalUrl,
    canonicalUrl: row.canonicalUrl,
    jobId: job?.id ?? null,
    campaignId: job?.campaignId ?? null,
    jobKey: job?.key ?? null,
    title: job?.title ?? "Previously handled job link",
    company: job?.company || null,
    decision: row.decision,
    preparation,
    reason: row.reason,
    matchScore: fit?.score ?? null,
    questionsPending: collection?.coverage !== "complete" || unansweredCount > 0,
    unansweredCount,
    provider: row.provider,
    workItemId: job?.workItem?.id ?? preparationWork?.id ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
function replay(raw: Prisma.JsonValue) {
  const value = raw as Record<string, unknown>;
  return jobIntakeSchema.parse({
    ...value,
    createdAt: new Date(String(value.createdAt)),
    updatedAt: new Date(String(value.updatedAt)),
  });
}
async function priorRequest(
  tx: Prisma.TransactionClient,
  userId: string,
  requestId: string,
  payloadHash: string,
) {
  const prior = await tx.jobIntakeRequest.findUnique({
    where: { userId_requestId: { userId, requestId } },
  });
  if (!prior) return null;
  if (prior.payloadHash !== payloadHash)
    throw conflict("Job-link request ID was reused with different details.");
  return replay(prior.response);
}
async function record(
  tx: Prisma.TransactionClient,
  scoring: ScoringService,
  userId: string,
  requestId: string,
  payloadHash: string,
  row: JobIntake,
) {
  const result = await view(tx, scoring, userId, row);
  await tx.jobIntakeRequest.create({
    data: { userId, requestId, payloadHash, intakeId: row.id, response: toInputJson(result) },
  });
  return result;
}

@singleton()
export class JobIntakeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scoring: ScoringService,
  ) {}
  async list(userId: string, query: PaginationQuery) {
    const [rows, total] = await Promise.all([
      this.prisma.jobIntake.findMany({
        where: { userId },
        ...pageSlice(query),
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.jobIntake.count({ where: { userId } }),
    ]);
    return paginate(
      await Promise.all(rows.map((row) => view(this.prisma, this.scoring, userId, row))),
      query,
      total,
    );
  }
  async get(userId: string, id: string) {
    const row = await this.prisma.jobIntake.findFirst({ where: { id, userId } });
    if (!row) throw notFound("Job link not found.");
    return view(this.prisma, this.scoring, userId, row);
  }
  async create(userId: string, raw: IntakeCreate, actor: HumanActor) {
    const input = intakeCreateSchema.parse(raw),
      originalUrl = intakeUrl(input.url),
      payloadHash = workHash({ action: "intake", input });
    const existing = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertHumanActor(tx, userId, actor);
      const prior = await priorRequest(tx, userId, input.requestId, payloadHash);
      if (prior) return prior;
      const saved = await tx.jobIntake.findFirst({
        where: { userId, OR: [{ canonicalUrl: originalUrl }, { originalUrl }] },
      });
      return saved ? record(tx, this.scoring, userId, input.requestId, payloadHash, saved) : null;
    });
    if (existing) return existing;
    const details = await resolveIntake(this.prisma, userId, originalUrl);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const prior = await priorRequest(tx, userId, input.requestId, payloadHash);
      if (prior) return prior;
      const saved = await tx.jobIntake.findUnique({
        where: { userId_canonicalUrl: { userId, canonicalUrl: details.canonicalUrl } },
      });
      if (saved) return record(tx, this.scoring, userId, input.requestId, payloadHash, saved);
      const urls = [...new Set([originalUrl, details.canonicalUrl])];
      const attempts = await Promise.all(
        urls.map((url) => findSubmissionAttempt(tx, userId, { url })),
      );
      const handled =
        (await hasIntakeApplication(tx, userId, urls)) ||
        attempts.some(
          (attempt) =>
            !!(attempt?.startedAt || attempt?.legacyOutcomeUnknown || attempt?.recordedAt),
        );
      let job = await existingIntakeJob(tx, userId, urls);
      const previouslyAuthorized =
        !!job && ["approved", "applying", "applied"].includes(job.status);
      if (!job && !handled) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { primaryResumeId: true },
        });
        const settings = await tx.autoApplySettings.findUnique({ where: { userId } });
        const campaign = await tx.campaign.create({
          data: {
            userId,
            query: "Prepared job link",
            source: "apply",
            config: {
              ...(user.primaryResumeId ? { resumeId: user.primaryResumeId } : {}),
              minScore: settings?.minMatchScore ?? 60,
              maxApplications: 1,
              discovery: {
                phase: "complete",
                intent: "apply",
                searches: [],
                sources: [],
                completedAt: new Date().toISOString(),
                reason: "Exact user-supplied link; preparation is not application authorization.",
              },
            },
          },
        });
        const created = await tx.job.create({
          data: {
            campaignId: campaign.campaignId,
            key: candidateKey(details.canonicalUrl),
            url: details.canonicalUrl,
            title: details.title,
            company: details.company,
            location: details.location,
            description: details.description,
            board: details.board,
            status: details.description ? "pending" : "queued",
            intakeDecisionRequired: true,
            humanApprovalRequired: true,
            retryNotes: "Prepare this exact posting, then wait for the applicant's decision.",
          },
          include: { workItem: true },
        });
        job = created;
      }
      const existingWork =
        job?.workItem && !["failed", "cancelled", "skipped"].includes(job.workItem.state);
      let decision: "pending" | "skip" | "queue" = "pending";
      let reason =
        "Link saved for preparation. Scoring, missing questions and your application decision may still be pending.";
      if (existingWork || previouslyAuthorized) {
        decision = "queue";
        reason =
          "Existing owned work is linked. Sending this link did not create or change its application authorization.";
      }
      if (handled) {
        decision = "skip";
        reason =
          "Existing submission history requires outcome review. This link never authorizes another application.";
      }
      const row = await tx.jobIntake.create({
        data: {
          userId,
          jobId: handled ? null : job?.id,
          originalUrl,
          canonicalUrl: details.canonicalUrl,
          provider: job?.workItem?.provider ?? null,
          authorship,
          resolved: details.resolved || !!job?.workItem,
          decision,
          reason,
        },
      });
      return record(tx, this.scoring, userId, input.requestId, payloadHash, row);
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
    return result;
  }
  async prepare(userId: string, id: string, raw: IntakePrepare, actor: HumanActor) {
    const input = intakePrepareSchema.parse(raw),
      payloadHash = workHash({ action: "prepare", id, input });
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertHumanActor(tx, userId, actor);
      const prior = await priorRequest(tx, userId, input.requestId, payloadHash);
      if (prior) return prior;
      const row = await tx.jobIntake.findFirst({ where: { id, userId } });
      if (!row?.jobId) throw notFound("Active owned job link not found.");
      if (row.revision !== input.expectedRevision || row.decision !== "pending")
        throw conflict("This job link changed. Review its current preparation.");
      if (row.provider && row.provider !== input.provider)
        throw conflict("This job already has a selected provider; this action cannot switch it.");
      if (!row.resolved)
        throw conflict(
          "This employer destination remains unresolved. Resolve it manually before preparation can be queued.",
        );
      const job = await tx.job.findFirst({ where: { id: row.jobId, campaign: { userId } } });
      if (!job) throw notFound("Owned job not found.");
      if (["approved", "applying", "applied", "skipped"].includes(job.status))
        throw conflict("Existing application activity must be reviewed before preparation.");
      const active = await tx.workItem.findFirst({
        where: {
          userId,
          state: { in: ["preparing", "ready", "filling", "stopping"] },
          OR: [
            { jobId: job.id },
            { intent: "intake_prepare", payload: { path: ["intakeId"], equals: row.id } },
          ],
        },
      });
      if (active) throw conflict("A worker already owns this job; preparation cannot restart it.");
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { campaignId: job.campaignId },
      });
      const config = campaignConfigSchema.parse(campaign.config);
      const selected =
        config.resumeId ??
        (
          await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { primaryResumeId: true },
          })
        ).primaryResumeId;
      if (
        !selected ||
        !(await tx.resume.findFirst({
          where: { id: selected, userId, sourceFilename: { not: null } },
        }))
      )
        throw conflict("Select your original resume in OpenApply /resumes before preparation.");
      if (!config.resumeId)
        await tx.campaign.update({
          where: { campaignId: job.campaignId },
          data: { config: toInputJson({ ...config, resumeId: selected }) },
        });
      const source = await this.scoring.preparationContext(
        userId,
        { campaignId: job.campaignId, jobKey: job.key, resumeId: selected },
        tx,
      );
      const workItemId = crypto.randomUUID();
      const snapshot = preparationSnapshot({
        version: 1,
        purpose: "intake_prepare",
        workItemId,
        intakeId: row.id,
        intakeRevision: row.revision + 1,
        jobId: job.id,
        campaignId: job.campaignId,
        jobKey: job.key,
        url: job.url,
        provider: input.provider,
        resumeId: selected,
        sourceSha256: source.basis.sourceSha256,
        sourceTextSha256: source.basis.sourceTextSha256,
        preferencesSha256: source.basis.preferencesSha256,
      });
      await tx.workItem.updateMany({
        where: {
          userId,
          intent: "intake_prepare",
          payload: { path: ["intakeId"], equals: row.id },
          state: { in: ["queued", "paused", "needs_user"] },
        },
        data: {
          state: "cancelled",
          cancellationRequestedAt: new Date(),
          finishedAt: new Date(),
          reason:
            "Superseded by a new explicit preparation request; previous grants cannot execute it.",
        },
      });
      await tx.workItem.create({
        data: {
          id: workItemId,
          userId,
          kind: "pilot_task",
          source: "user",
          provider: input.provider,
          identity: `intake-prepare:${row.id}:${input.requestId}`,
          intent: "intake_prepare",
          campaignId: job.campaignId,
          title: `Prepare ${job.title}`,
          company: job.company,
          payload: toInputJson(snapshot),
          reason:
            "Exact preparation is saved. Live execution requires an isolated preparation host and a separate finite grant; the current subscription-provider host remains blocked. Submission is unavailable to this worker.",
        },
      });
      const updated = await tx.jobIntake.update({
        where: { id },
        data: {
          provider: input.provider,
          revision: { increment: 1 },
          reason:
            "Exact preparation is saved. The current subscription-provider host cannot safely isolate preparation tools, so live execution remains blocked. Your application decision remains pending.",
        },
      });
      return record(tx, this.scoring, userId, input.requestId, payloadHash, updated);
    });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return result;
  }
  async decide(userId: string, id: string, raw: IntakeDecision, actor: HumanActor) {
    const input = intakeDecisionSchema.parse(raw),
      payloadHash = workHash({ action: "decision", id, input });
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await assertHumanActor(tx, userId, actor);
      const prior = await priorRequest(tx, userId, input.requestId, payloadHash);
      if (prior) return prior;
      const row = await tx.jobIntake.findFirst({ where: { id, userId } });
      if (!row?.jobId) throw notFound("Active owned job link not found.");
      if (row.revision !== input.expectedRevision || row.decision !== "pending")
        throw conflict("This job link already has a decision or changed. Reload it.");
      const job = await tx.job.findFirst({
        where: { id: row.jobId, campaign: { userId } },
        include: { campaign: true, workItem: true },
      });
      if (!job) throw notFound("Owned job not found.");
      if (["applying", "applied"].includes(job.status) || job.workItem?.leaseToken)
        throw conflict(
          "Existing active work must be reviewed; this decision cannot restart or rewind it.",
        );
      const preparationWork = await tx.workItem.findMany({
        where: {
          userId,
          intent: "intake_prepare",
          payload: { path: ["intakeId"], equals: row.id },
          state: {
            in: ["queued", "preparing", "ready", "filling", "stopping", "needs_user", "paused"],
          },
        },
      });
      if (
        input.decision !== "skip" &&
        preparationWork.some((work) =>
          ["preparing", "ready", "filling", "stopping"].includes(work.state),
        )
      )
        throw conflict(
          "Wait for the exact preparation worker to finish before authorizing application work.",
        );
      const attempt = await findSubmissionAttempt(tx, userId, { jobId: job.id, url: job.url });
      if (attempt?.startedAt || attempt?.legacyOutcomeUnknown || attempt?.recordedAt)
        throw conflict("Existing submission evidence requires recovery.");
      if (row.provider && input.provider && row.provider !== input.provider)
        throw conflict(
          "This job already uses a different provider; this decision cannot switch it.",
        );
      const provider = row.provider ?? job.workItem?.provider ?? input.provider ?? null;
      if (input.decision !== "skip") {
        if (!row.resolved)
          throw conflict(
            "This employer destination remains unresolved. Review it manually; it cannot be queued for application.",
          );
        if (!provider)
          throw conflict("Choose the provider for this job in OpenApply before queueing.");
        assertAutomationAllowed(job.url);
        if (await companyExcluded(tx, userId, job.company))
          throw conflict("This company is excluded by your saved application rules.");
        const fit = await assertCurrentFit(this.scoring, userId, job, true, tx);
        assertDiscoveryReady(campaignConfigSchema.parse(job.campaign.config), fit);
        if (
          !fit?.preferenceChecks ||
          fit.preferenceChecks.eligibility.some((check) => check.status !== "met")
        )
          throw conflict("Resolve current preference and explicit eligibility checks first.");
        await tx.jobIntake.update({ where: { id }, data: { decision: input.decision } });
        await tx.job.update({
          where: { id: job.id },
          data: { intakeDecisionRequired: false, humanApprovalRequired: true, status: "approved" },
        });
        const items = await enqueueApplications(tx, userId, {
          idempotencyKey: input.requestId,
          jobIds: [job.id],
          source: "user",
          provider,
        });
        if (input.decision === "apply_now" && items[0]?.state === "queued")
          await tx.workItem.update({
            where: { id: items[0].id },
            data: { priorityRequestedAt: new Date() },
          });
      } else {
        await tx.job.update({
          where: { id: job.id },
          data: {
            status: "skipped",
            intakeDecisionRequired: true,
            skipReason: "Skipped by the applicant after link preparation.",
          },
        });
        if (job.workItem)
          await tx.workItem.update({
            where: { id: job.workItem.id },
            data: {
              state: job.workItem.leaseToken ? "stopping" : "cancelled",
              cancellationRequestedAt: new Date(),
              reason: "Skipped by the applicant.",
            },
          });
      }
      const updated = await tx.jobIntake.update({
        where: { id },
        data: {
          decision: input.decision,
          revision: { increment: 1 },
          provider,
          reason:
            input.decision === "skip"
              ? "Application skipped."
              : "Application queued under the common limits. A separate local model grant and exact-checkpoint human approval remain required.",
        },
      });
      for (const work of preparationWork)
        await tx.workItem.update({
          where: { id: work.id },
          data: {
            state: ["preparing", "ready", "filling", "stopping"].includes(work.state)
              ? "stopping"
              : "cancelled",
            cancellationRequestedAt: new Date(),
            reason: "The applicant decided this intake; its preparation capability is revoked.",
          },
        });
      return record(tx, this.scoring, userId, input.requestId, payloadHash, updated);
    });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return result;
  }
}
