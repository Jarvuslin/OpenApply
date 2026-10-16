import { pageSlice, paginate } from "@openapply/contracts/pagination";
import { workQueueChannel } from "@openapply/contracts/sse";
import {
  type EnqueueCampaignWork,
  type EnqueueWork,
  type FinishWork,
  WORK_VIEW_STATES,
  type WorkEventInput,
  type WorkListQuery,
  workEventSchema,
} from "@openapply/contracts/work-queue";
import { singleton } from "tsyringe";
import { conflict, HttpError, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { deleteSubmissionScreenshot } from "@/common/storage/storage";
import { cleanAgentText } from "@/common/utils/agent-text";
import { type Prisma, PrismaClient, type WorkItem } from "@/generated/prisma/client";
import { waitingAccountId } from "@/modules/account-setup/account-setup.parent";
import { storedAccountSetup } from "@/modules/account-setup/account-setup.snapshot";
import {
  hasJobQuestionBlockers,
  reopenParkedJob,
} from "@/modules/application-question/question.resume";
import { enqueueApplications, lockWorkUser } from "./work-queue.admission";
import { autoRetryWhere, MAX_AUTO_RETRIES, withPreviousFailure } from "./work-queue.auto-retry";
import {
  applicationProgressState,
  checkWorkLease,
  controlState,
  LIVE_WORK_STATES,
  RECOVERY_REASON,
  TERMINAL_WORK_STATES,
  WORK_LEASE_MS,
  workHash,
} from "./work-queue.policy";
import { canonicalWorkOutcome } from "./work-queue.recovery";
import {
  readQueuePolicy,
  releaseSettledExecutions,
  settleWorkExecution,
} from "./work-queue.reservations";
import { workItemView } from "./work-queue.view";

function changed(userId: string, itemId?: string) {
  publish(workQueueChannel, { userId }, { type: "work-queue.changed", itemId });
}

@singleton()
export class WorkQueueService {
  constructor(private readonly prisma: PrismaClient) {}

  private async owned(tx: Prisma.TransactionClient, userId: string, id: string) {
    const item = await tx.workItem.findFirst({ where: { id, userId } });
    if (!item) throw notFound("Work item not found.");
    return item;
  }

  private async expire(tx: Prisma.TransactionClient, userId: string) {
    const expired = await tx.workItem.findMany({
      where: { userId, state: { in: LIVE_WORK_STATES }, leaseExpiresAt: { lte: new Date() } },
    });
    for (const item of expired) {
      const result = await canonicalWorkOutcome(
        tx,
        item,
        item.kind === "application" ? "waiting" : "failed",
      );
      await tx.workItem.update({
        where: { id: item.id },
        data: {
          state: result.state,
          applicationId: result.applicationId,
          reason: RECOVERY_REASON,
          leaseExpiresAt: null,
          finishedAt: new Date(),
        },
      });
      await settleWorkExecution(tx, item);
    }
  }

  async refresh(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await this.expire(tx, userId);
      const active = await tx.workItem.findMany({
        where: {
          userId,
          kind: "application",
          state: { in: ["preparing", "ready"] },
          pauseRequestedAt: null,
          cancellationRequestedAt: null,
        },
        include: { job: true },
      });
      for (const item of active) {
        const state = applicationProgressState(item.state, item.job?.status ?? "");
        if (state !== item.state)
          await tx.workItem.update({ where: { id: item.id }, data: { state } });
      }
      await releaseSettledExecutions(tx, userId);
      // Receipt recording remains valid after lease loss; reflect that durable evidence without replay.
      const pending = await tx.workItem.findMany({
        where: {
          userId,
          kind: "application",
          state: { not: "submitted" },
          job: { submissionAttempt: { recordedAt: { not: null } } },
        },
      });
      for (const item of pending) {
        const result = await canonicalWorkOutcome(tx, item, "completed");
        if (result.state === "submitted") {
          const saved = await tx.workItem.update({
            where: { id: item.id },
            data: {
              state: "submitted",
              applicationId: result.applicationId,
              reason: null,
              leaseExpiresAt: null,
              finishedAt: new Date(),
            },
          });
          await settleWorkExecution(tx, saved);
        }
      }
    });
  }

  async list(userId: string, query: WorkListQuery) {
    await this.refresh(userId);
    // Account setup runs on behalf of an application row, which shows its progress instead.
    const where: Prisma.WorkItemWhereInput = {
      userId,
      OR: [{ intent: null }, { intent: { not: "account_setup" } }],
    };
    if (query.state) where.state = query.state;
    else if (query.view) where.state = { in: [...WORK_VIEW_STATES[query.view]] };
    const [rows, total] = await Promise.all([
      this.prisma.workItem.findMany({
        where,
        ...pageSlice(query),
        orderBy: [
          { priorityRequestedAt: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
      this.prisma.workItem.count({ where }),
    ]);
    return paginate(
      await Promise.all(rows.map((row) => workItemView(this.prisma, userId, row))),
      query,
      total,
    );
  }

  /**
   * What a connected computer may start now: one account setup first, then one pilot run to score,
   * else a wave of applications.
   */
  async runnable(userId: string) {
    await this.refresh(userId);
    const policy = await readQueuePolicy(this.prisma, userId);
    if (policy.autoRetryFailed) await this.retryFailed(userId);
    const runsRemaining = policy.runsRemaining ?? null;
    const empty = { maxConcurrentWorkers: policy.maxConcurrentWorkers, runsRemaining };
    if (runsRemaining === 0) return { ...empty, applicationIds: [], accountIds: [], pilotIds: [] };
    const orderBy: Prisma.WorkItemOrderByWithRelationInput[] = [
      { priorityRequestedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ];
    const [accounts, pilots, applications] = await Promise.all([
      this.prisma.workItem.findMany({
        where: { userId, state: "queued", intent: "account_setup" },
        orderBy,
        take: 1,
        select: { id: true },
      }),
      this.prisma.workItem.findMany({
        where: { userId, state: "queued", kind: "pilot_task", intent: "pilot_score" },
        orderBy,
        take: 1,
        select: { id: true },
      }),
      this.prisma.workItem.findMany({
        where: { userId, state: "queued", kind: "application" },
        orderBy,
        // Extra candidates let the computer skip work that is waiting, e.g. on domain spacing.
        take: Math.min(20, runsRemaining ?? 20),
        select: { id: true },
      }),
    ]);
    return {
      ...empty,
      accountIds: accounts.map((row) => row.id),
      pilotIds: pilots.map((row) => row.id),
      applicationIds: applications.map((row) => row.id),
    };
  }

  async summary(userId: string) {
    await this.refresh(userId);
    const groups = await this.prisma.workItem.groupBy({
      by: ["state"],
      where: { userId },
      _count: true,
    });
    const count = (states: string[]) =>
      groups
        .filter((row) => states.includes(row.state))
        .reduce((total, row) => total + row._count, 0);
    return {
      queued: count(["queued"]),
      running: count(LIVE_WORK_STATES),
      needsUser: count(["needs_user"]),
      paused: count(["paused"]),
      total: groups.reduce((total, row) => total + row._count, 0),
    };
  }

  async detail(userId: string, id: string) {
    await this.refresh(userId);
    const item = await this.owned(this.prisma, userId, id);
    const events = await this.prisma.workEvent.findMany({
      where: { workItemId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    return {
      item: await workItemView(this.prisma, userId, item),
      events: events.reverse().map((row) => workEventSchema.parse(row)),
    };
  }

  async enqueue(userId: string, input: EnqueueWork) {
    const items = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      return enqueueApplications(tx, userId, input);
    });
    changed(userId);
    return { items: await Promise.all(items.map((row) => workItemView(this.prisma, userId, row))) };
  }

  async campaign(userId: string, campaignId: string, input: EnqueueCampaignWork) {
    const items = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const payloadHash = workHash({
        campaignId,
        ...input,
        jobIds: input.jobIds ? [...new Set(input.jobIds)].sort() : null,
      });
      const prior = await tx.workRequest.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Queue request was already used with different details.");
        return tx.workItem.findMany({ where: { userId, id: { in: prior.itemIds } } });
      }
      const campaign = await tx.campaign.findFirst({ where: { campaignId, userId } });
      if (!campaign) throw notFound("Campaign not found.");
      if (
        input.jobIds &&
        (await tx.job.count({ where: { id: { in: [...new Set(input.jobIds)] }, campaignId } })) !==
          new Set(input.jobIds).size
      )
        throw notFound("Selected jobs do not belong to this campaign.");
      if (campaign.status === "completed" || campaign.status === "failed")
        throw conflict("This campaign has finished.");
      if (campaign.status === "paused" && input.action === "resume")
        await tx.campaign.update({
          where: { campaignId },
          data: {
            status: "in_progress",
            statusActor: "user",
            statusReason: "Preparation resumed through the common queue.",
          },
        });
      if (input.action === "resume") {
        const paused = await tx.workItem.findMany({
          where: {
            userId,
            campaignId,
            state: "paused",
            OR: [{ intent: null }, { intent: { not: "intake_prepare" } }],
            ...(input.jobIds ? { jobId: { in: input.jobIds } } : {}),
          },
        });
        for (const held of paused) {
          const outcome = await canonicalWorkOutcome(tx, held, "completed");
          if (outcome.ambiguous) {
            await tx.workItem.update({
              where: { id: held.id },
              data: { state: "needs_user", reason: RECOVERY_REASON },
            });
            continue;
          }
          await tx.workItem.update({
            where: { id: held.id },
            data: {
              state: "queued",
              pauseRequestedAt: null,
              cancellationRequestedAt: null,
              leaseToken: null,
              leaseExpiresAt: null,
              finishedAt: null,
              reason: null,
            },
          });
        }
      }
      const intent = {
        start: "campaign_start",
        resume: "campaign_resume",
        rescan: "campaign_rescan",
        retry_failed: "campaign_retry_failed",
      }[input.action] as
        | "campaign_start"
        | "campaign_resume"
        | "campaign_rescan"
        | "campaign_retry_failed";
      const identity = `campaign:${campaignId}:${intent}:${workHash(input.jobIds ? [...new Set(input.jobIds)].sort() : [])}`;
      const current = await tx.workItem.findUnique({
        where: { userId_identity: { userId, identity } },
      });
      let item: WorkItem;
      if (current && !TERMINAL_WORK_STATES.includes(current.state)) {
        if (current.provider !== input.provider)
          throw conflict("This campaign task already uses a different provider.");
        item = current;
      } else if (current)
        item = await tx.workItem.update({
          where: { id: current.id },
          data: {
            provider: input.provider,
            state: "queued",
            finishedAt: null,
            reason: null,
            cancellationRequestedAt: null,
            pauseRequestedAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      else
        item = await tx.workItem.create({
          data: {
            userId,
            kind: "pilot_task",
            source: "campaign",
            provider: input.provider,
            identity,
            campaignId,
            intent,
            title: campaign.query,
            payload: { jobIds: input.jobIds ?? [] },
          },
        });
      await tx.workRequest.create({
        data: { userId, idempotencyKey: input.idempotencyKey, payloadHash, itemIds: [item.id] },
      });
      return [item];
    });
    changed(userId);
    return { items: await Promise.all(items.map((row) => workItemView(this.prisma, userId, row))) };
  }

  async heartbeat(userId: string, id: string, token: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await this.owned(tx, userId, id);
      checkWorkLease(item, token);
      const job = item.jobId
        ? await tx.job.findFirst({
            where: { id: item.jobId, campaign: { userId } },
            select: { status: true },
          })
        : null;
      const state =
        item.pauseRequestedAt || item.cancellationRequestedAt
          ? item.state
          : applicationProgressState(item.state, job?.status ?? "");
      return workItemView(
        tx,
        userId,
        await tx.workItem.update({
          where: { id },
          data: {
            state,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + WORK_LEASE_MS),
          },
        }),
      );
    });
  }

  async progress(userId: string, id: string, token: string, state: "ready" | "filling") {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await this.owned(tx, userId, id);
      checkWorkLease(item, token);
      if (item.pauseRequestedAt || item.cancellationRequestedAt)
        throw conflict("This work is stopping.");
      if (
        item.kind !== "application" ||
        (state === "ready" && item.state !== "preparing") ||
        (state === "filling" && item.state !== "ready")
      )
        throw conflict("Invalid work progress transition.");
      return tx.workItem.update({ where: { id }, data: { state } });
    });
    changed(userId, id);
    return workItemView(this.prisma, userId, result);
  }

  async event(userId: string, id: string, input: WorkEventInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await this.owned(tx, userId, id);
      if (item.leaseToken !== input.leaseToken) throw conflict("Work lease does not match.");
      // Account text may hold codes or mail; tool-activity lines only name the tool.
      const toolLine =
        input.kind === "activity" &&
        /^(Using [\w-]{1,120}|[\w-]{1,120} (finished|failed))\.$/.test(input.content);
      const content =
        item.intent === "account_setup" && !toolLine
          ? `Account setup worker ${input.kind}.`
          : cleanAgentText(input.content).replaceAll(input.leaseToken, "[redacted]");
      const metadata = item.intent === "account_setup" ? undefined : input.metadata;
      const payloadHash = workHash({
        kind: input.kind,
        content,
        metadata: metadata ?? null,
        providerSessionId:
          item.intent === "account_setup" ? null : (input.providerSessionId ?? null),
      });
      const prior = await tx.workEvent.findUnique({
        where: { workItemId_eventId: { workItemId: id, eventId: input.eventId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Event id was already used with different details.");
        return prior;
      }
      checkWorkLease(item, input.leaseToken);
      const event = await tx.workEvent.create({
        data: {
          workItemId: id,
          eventId: input.eventId,
          payloadHash,
          kind: input.kind,
          content,
          metadata: metadata ? toInputJson(metadata) : undefined,
        },
      });
      return event;
    });
    changed(userId, id);
    return workEventSchema.parse(result);
  }

  async finish(userId: string, id: string, input: FinishWork) {
    const item = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await this.owned(tx, userId, id);
      if (item.leaseToken !== input.leaseToken) throw conflict("Work lease does not match.");
      if (!LIVE_WORK_STATES.includes(item.state)) return item;
      checkWorkLease(item, input.leaseToken);
      const canonical = await canonicalWorkOutcome(tx, item, input.status);
      let state = canonical.state;
      if (
        item.jobId &&
        state === "needs_user" &&
        !canonical.ambiguous &&
        !item.pauseRequestedAt &&
        !item.cancellationRequestedAt
      ) {
        const answered = await tx.pilotQuestion.findFirst({
          where: {
            userId,
            subjectType: "job",
            subjectId: item.jobId,
            status: "answered",
            answeredAt: { gte: item.startedAt ?? item.createdAt },
          },
        });
        const factual = await tx.applicationQuestionAnswer.findFirst({
          where: {
            userId,
            question: { jobId: item.jobId },
            confirmedAt: { gte: item.startedAt ?? item.createdAt },
          },
        });
        const campaign = item.campaignId
          ? await tx.campaign.findFirst({ where: { campaignId: item.campaignId, userId } })
          : null;
        if (
          (answered || factual) &&
          campaign?.status === "in_progress" &&
          !(await hasJobQuestionBlockers(tx, userId, item.jobId))
        )
          state = "queued";
      }
      if (
        item.jobId &&
        !canonical.ambiguous &&
        !item.pauseRequestedAt &&
        !item.cancellationRequestedAt &&
        (await hasJobQuestionBlockers(tx, userId, item.jobId))
      )
        state = "needs_user";
      let reason =
        state === "submitted" || state === "completed"
          ? null
          : cleanAgentText(
              (item.intent === "account_setup"
                ? "Account setup requires review; signup cannot be retried."
                : input.error) ??
                (canonical.ambiguous
                  ? RECOVERY_REASON
                  : "Execution requires review before continuing."),
            );
      const accountId = waitingAccountId(item);
      let payload: Prisma.InputJsonValue | undefined;
      if (accountId && state === "needs_user" && !canonical.ambiguous) {
        const account = await tx.workItem.findFirst({ where: { id: accountId, userId } });
        // The account can finish before this worker does; then the application continues at once.
        if (account && storedAccountSetup(account).attempt.phase === "authenticated") {
          state = "queued";
          reason = null;
          payload = {};
        } else reason = item.reason;
      }
      const saved = await tx.workItem.update({
        where: { id },
        data: {
          state,
          applicationId: canonical.applicationId,
          reason,
          leaseExpiresAt: null,
          finishedAt: new Date(),
          ...(payload && { payload }),
        },
      });
      await settleWorkExecution(tx, item);
      return saved;
    });
    changed(userId, id);
    return workItemView(this.prisma, userId, item);
  }

  /** Requeues failed runs whose wait is over; the next run is told why the last one failed. */
  private async retryFailed(userId: string) {
    const due = await this.prisma.workItem.findMany({
      where: autoRetryWhere(userId, new Date()),
      select: { id: true, reason: true, payload: true },
      orderBy: { finishedAt: "asc" },
      take: 5,
    });
    for (const item of due) {
      await this.prisma.workItem.update({
        where: { id: item.id },
        data: {
          autoRetries: { increment: 1 },
          payload: toInputJson(withPreviousFailure(item.payload, item.reason)),
        },
      });
      try {
        await this.control(userId, item.id, "resume");
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        // Not replayable (an ambiguous submission, a paused search): never try it automatically again.
        await this.prisma.workItem.update({
          where: { id: item.id },
          data: { autoRetries: MAX_AUTO_RETRIES },
        });
      }
    }
  }

  async control(userId: string, id: string, action: "pause" | "resume" | "stop") {
    const item = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await this.expire(tx, userId);
      const item = await this.owned(tx, userId, id);
      let state = controlState(item, action);
      if (
        action !== "resume" &&
        item.kind === "application" &&
        !LIVE_WORK_STATES.includes(item.state)
      ) {
        const canonical = await canonicalWorkOutcome(tx, item, "completed");
        if (canonical.ambiguous || canonical.state === "submitted") state = canonical.state;
      }
      if (action === "resume") {
        if (item.intent === "account_setup")
          throw conflict("Account setup is single-use and cannot resume or retry.");
        if (item.intent === "intake_prepare")
          throw conflict(
            "Preparation grants cannot be replayed. Prepare the intake explicitly to create new exact work.",
          );
        if (
          item.kind === "application" &&
          !(await tx.job.findFirst({
            where: { id: item.jobId!, campaign: { userId, status: "in_progress" } },
            select: { id: true },
          }))
        )
          throw conflict("Resume the campaign before resuming its application work.");
        if (item.intent === "unavailable")
          throw conflict(
            "This Pilot task requires manual review and cannot execute automatically.",
          );
        const canonical = await canonicalWorkOutcome(tx, item, "completed");
        if (canonical.ambiguous || canonical.state === "submitted")
          throw conflict("Submission evidence requires recovery; this work cannot be replayed.");
        if (item.jobId && (await hasJobQuestionBlockers(tx, userId, item.jobId)))
          throw conflict("Resolve application questions and form coverage before resuming.");
      }
      const data: Prisma.WorkItemUpdateInput = { state };
      if (action === "resume")
        Object.assign(data, {
          reason: null,
          cancellationRequestedAt: null,
          pauseRequestedAt: null,
          finishedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        });
      else if (!TERMINAL_WORK_STATES.includes(item.state)) {
        if (action === "pause") data.pauseRequestedAt = item.pauseRequestedAt ?? new Date();
        else data.cancellationRequestedAt = item.cancellationRequestedAt ?? new Date();
        if (!LIVE_WORK_STATES.includes(state)) data.finishedAt = new Date();
      }
      const result = await tx.workItem.update({ where: { id }, data });
      if (action === "resume" && item.jobId) await reopenParkedJob(tx, item.jobId);
      if (!LIVE_WORK_STATES.includes(state)) await settleWorkExecution(tx, item);
      return result;
    });
    changed(userId, id);
    return workItemView(this.prisma, userId, item);
  }

  async remove(userId: string, id: string) {
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await this.expire(tx, userId);
      const item = await this.owned(tx, userId, id);
      if (LIVE_WORK_STATES.includes(item.state)) return false;
      await settleWorkExecution(tx, item);
      await tx.workItem.delete({ where: { id } });
      return true;
    });
    // A running worker must stop first; the row can be removed once it has stopped.
    if (!removed) {
      await this.control(userId, id, "stop");
      return { removed: false };
    }
    await deleteSubmissionScreenshot(id);
    changed(userId, id);
    return { removed: true };
  }
}
