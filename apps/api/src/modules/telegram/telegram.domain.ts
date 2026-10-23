import { questionDefinitionSchema } from "@openapply/contracts/application-question";
import { singleton } from "tsyringe";
import type { HumanActor } from "@/common/auth/human-actor";
import { conflict } from "@/common/errors";
import {
  PrismaClient,
  type TelegramAction,
  type TelegramDelivery,
} from "@/generated/prisma/client";
import { ApplicationQuestionService } from "@/modules/application-question/application-question.service";
import { countNeedsYou, listNeedsYou } from "@/modules/application-question/question.needs-you";
import { ApplicationRulesService } from "@/modules/application-rules/application-rules.service";
import { JobIntakeService } from "@/modules/job-intakes/job-intake.service";
import { PilotCheckpointApprovalService } from "@/modules/pilot/checkpoint-approval.service";
import { RuntimePresenceService } from "@/modules/runtime-presence/runtime-presence.service";
import { WorkQueueService } from "@/modules/work-queue/work-queue.service";
import type { TelegramActionSpec, TelegramNotice } from "./telegram.notice";
import { safeTelegramQuestion } from "./telegram.policy";

@singleton()
export class TelegramDomain {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly intake: JobIntakeService,
    private readonly rules: ApplicationRulesService,
    private readonly questions: ApplicationQuestionService,
    private readonly approvals: PilotCheckpointApprovalService,
    private readonly presence: RuntimePresenceService,
    private readonly queue: WorkQueueService,
  ) {}
  async status(userId: string) {
    const [queue, needs, presence] = await Promise.all([
      this.queue.summary(userId),
      countNeedsYou(this.prisma, userId),
      this.presence.read(userId),
    ]);
    return {
      queued: queue.queued,
      running: queue.running,
      needsYou: needs.total,
      presence: presence.status,
      executionAvailable: presence.executionAvailable,
      lastSeenAt: presence.lastSeenAt?.toISOString() ?? null,
    };
  }
  async add(
    userId: string,
    url: string,
    requestId: string,
    actor: HumanActor,
  ): Promise<TelegramNotice> {
    const row = await this.intake.create(userId, { requestId, url }, actor);
    return this.intakeNotice(row, intakeEventKey(row));
  }
  private intakeNotice(
    row: Awaited<ReturnType<JobIntakeService["get"]>>,
    eventKey: string,
  ): TelegramNotice {
    const actions: TelegramActionSpec[] = [];
    if (row.decision === "pending") {
      if (row.provider && row.preparation === "ready")
        for (const kind of ["apply_now", "queue"] as const)
          actions.push({ kind, targetId: row.id, expectedRevision: row.revision });
      actions.push({ kind: "skip", targetId: row.id, expectedRevision: row.revision });
    }
    return {
      eventKey,
      template: "intake",
      payload: {
        targetId: row.id,
        title: row.title,
        company: row.company,
        preparation: row.preparation,
        matchScore: row.matchScore,
        unansweredCount: row.unansweredCount,
      },
      actions,
    };
  }
  async exclusion(userId: string, company: string): Promise<TelegramActionSpec | null> {
    const exact = await this.rules.knownCompany(userId, company);
    if (!exact) return null;
    const current = await this.rules.list(userId);
    return {
      kind: "exclude_company",
      targetId: userId,
      expectedRevision: current.revision,
      payload: { company: exact },
    };
  }
  async current(action: TelegramAction) {
    if (action.kind === "answer")
      return !!(await this.prisma.applicationQuestion.findFirst({
        where: {
          id: action.targetId,
          userId: action.userId,
          current: true,
          blocking: true,
          category: "contact",
          revision: action.expectedRevision!,
          definitionHash: action.expectedHash!,
          job: { status: { notIn: ["applied", "skipped"] } },
        },
      }));
    if (["apply_now", "queue", "skip"].includes(action.kind)) {
      const row = await this.intake.get(action.userId, action.targetId);
      return row.decision === "pending" && row.revision === action.expectedRevision;
    }
    if (action.kind === "undo" || action.kind === "exclude_company")
      return (await this.rules.list(action.userId)).revision === action.expectedRevision;
    return false;
  }
  async noticeCurrent(row: TelegramDelivery) {
    const payload = row.payload as Record<string, unknown>,
      id = payload.targetId;
    if (typeof id !== "string") return !["intake", "question", "approval"].includes(row.template);
    if (row.template === "intake")
      return intakeEventKey(await this.intake.get(row.userId, id)) === row.eventKey;
    if (row.template === "approval") {
      const question = await this.approvals.read(row.userId, id);
      return (
        question.status === "open" &&
        !!question.approval &&
        question.approval.expiresAt > new Date() &&
        row.eventKey === `approval:${id}:${question.approval.checkpointHash}`
      );
    }
    if (row.template === "question") {
      if (row.eventKey.startsWith("question:")) {
        const question = await this.prisma.applicationQuestion.findFirst({
          where: {
            id,
            userId: row.userId,
            current: true,
            blocking: true,
            job: { status: { notIn: ["applied", "skipped"] } },
          },
        });
        return (
          !!question &&
          row.eventKey === `question:${id}:${question.revision}:${question.definitionHash}`
        );
      }
      if (row.eventKey.startsWith("attention:collection:")) {
        const collection = await this.prisma.jobQuestionCollection.findFirst({
          where: {
            id,
            userId: row.userId,
            coverage: { not: "complete" },
            job: { status: { notIn: ["applied", "skipped"] } },
          },
        });
        if (!collection) return false;
        return !(await this.prisma.jobQuestionCollection.findFirst({
          where: { jobId: collection.jobId, version: { gt: collection.version } },
        }));
      }
      return !!(await this.prisma.pilotQuestion.findFirst({
        where: {
          id,
          userId: row.userId,
          status: "open",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }));
    }
    return true;
  }
  async execute(action: TelegramAction): Promise<TelegramNotice> {
    const actor: HumanActor = {
      kind: "telegram_user",
      linkId: action.linkId,
      generation: action.generation,
    };
    const payload = action.payload as Record<string, unknown>;
    const done: TelegramNotice = { eventKey: `action:${action.id}`, template: "action_done" };
    switch (action.kind) {
      case "apply_now":
      case "queue":
      case "skip":
        await this.intake.decide(
          action.userId,
          action.targetId,
          {
            requestId: action.requestId,
            expectedRevision: action.expectedRevision!,
            decision: action.kind,
          },
          actor,
        );
        return done;
      case "exclude_company": {
        if (typeof payload.company !== "string") throw conflict("Invalid action.");
        const row = await this.rules.exclude(
          action.userId,
          {
            requestId: action.requestId,
            expectedRevision: action.expectedRevision!,
            company: payload.company,
          },
          actor,
        );
        return {
          eventKey: `action:${action.id}`,
          template: "rule",
          actions: row.undoAvailable
            ? [{ kind: "undo", targetId: row.id, expectedRevision: row.revision }]
            : [],
        };
      }
      case "undo":
        await this.rules.undo(
          action.userId,
          action.targetId,
          { requestId: action.requestId, expectedRevision: action.expectedRevision! },
          actor,
        );
        return done;
      case "approve":
      case "decline":
        if (typeof payload.checkpointId !== "string") throw conflict("Invalid action.");
        await this.approvals.decide(
          action.userId,
          action.targetId,
          {
            requestId: action.requestId,
            checkpointId: payload.checkpointId,
            checkpointHash: action.expectedHash!,
            decision: action.kind === "approve" ? "approve" : "skip",
          },
          actor,
        );
        return done;
      case "answer": {
        const question = await this.prisma.applicationQuestion.findFirst({
          where: {
            id: action.targetId,
            userId: action.userId,
            current: true,
            revision: action.expectedRevision!,
            definitionHash: action.expectedHash!,
          },
        });
        const definition = questionDefinitionSchema.safeParse(question?.definition);
        const safe = definition.success
          ? safeTelegramQuestion(question?.category ?? "other", definition.data)
          : null;
        if (
          !safe ||
          typeof payload.value !== "string" ||
          payload.fieldKey !== safe.fieldKey ||
          !safe.options.some(
            (option) => option.value === payload.value && option.label === payload.label,
          )
        )
          throw conflict("Review this answer in OpenApply.");
        await this.questions.answer(
          action.userId,
          action.targetId,
          {
            requestId: action.requestId,
            expectedRevision: action.expectedRevision!,
            expectedDefinitionHash: action.expectedHash!,
            confirmed: true,
            values: [{ fieldKey: safe.fieldKey, value: payload.value }],
          },
          actor,
        );
        return done;
      }
    }
  }
  async notices(userId: string, page: number) {
    const [attention, intakes] = await Promise.all([
      listNeedsYou(this.prisma, userId, { page, limit: 20, kind: "all" }),
      this.intake.list(userId, { page, limit: 20 }),
    ]);
    const notices: TelegramNotice[] = [];
    for (const entry of attention.items) {
      if (entry.kind === "application") {
        const row = entry.question,
          safe = safeTelegramQuestion(row.category, row.definition);
        notices.push({
          eventKey: `question:${row.id}:${row.revision}:${row.definitionHash}`,
          template: "question",
          payload: {
            targetId: row.id,
            title: entry.job.title,
            company: entry.job.company,
            safe: !!safe,
          },
          actions: safe
            ? safe.options.map((option) => ({
                kind: "answer",
                targetId: row.id,
                expectedRevision: row.revision,
                expectedHash: row.definitionHash,
                payload: { fieldKey: safe.fieldKey, value: option.value, label: option.label },
              }))
            : [],
        });
      } else if (entry.kind === "operational" && entry.question.approval) {
        const row = entry.question,
          approval = row.approval!;
        notices.push({
          eventKey: `approval:${row.id}:${approval.checkpointHash}`,
          template: "approval",
          payload: { targetId: row.id, title: approval.job.title, company: approval.job.company },
          actions: [
            {
              kind: "approve",
              targetId: row.id,
              expectedHash: approval.checkpointHash,
              payload: { checkpointId: approval.checkpointId },
              expiresAt: approval.expiresAt,
            },
            {
              kind: "decline",
              targetId: row.id,
              expectedHash: approval.checkpointHash,
              payload: { checkpointId: approval.checkpointId },
              expiresAt: approval.expiresAt,
            },
          ],
        });
      } else
        notices.push({
          eventKey: `attention:${entry.kind}:${entry.id}`,
          template: "question",
          payload: {
            targetId: entry.id,
            safe: false,
            ...(entry.kind === "collection"
              ? { title: entry.job.title, company: entry.job.company }
              : {}),
          },
        });
    }
    for (const row of intakes.items)
      if (row.decision === "pending") notices.push(this.intakeNotice(row, intakeEventKey(row)));
    return {
      notices,
      hasMore: page < Math.max(attention.pagination.totalPages, intakes.pagination.totalPages),
    };
  }
}
function intakeEventKey(row: Awaited<ReturnType<JobIntakeService["get"]>>) {
  return `intake:${row.id}:${row.revision}:${row.preparation}:${row.provider ?? "none"}:${row.matchScore ?? "none"}:${row.unansweredCount}`;
}
