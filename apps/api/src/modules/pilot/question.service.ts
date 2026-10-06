import type {
  AnswerPilotQuestionInput,
  CreatePilotQuestionInput,
  PilotQuestion,
  PilotQuestionStatus,
} from "@openapply/contracts/pilot";
import { pilotChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { conflict, findOwned } from "@/common/errors";
import { PushService } from "@/common/push/push.service";
import { publish } from "@/common/sse";
import { type PilotQuestion as PilotQuestionModel, PrismaClient } from "@/generated/prisma/client";

/** An unanswered 2FA code is useless within minutes, and expiring it frees the job it parked. */
const TWO_FACTOR_TTL_MS = 5 * 60 * 1000;

function toPilotQuestion(row: PilotQuestionModel): PilotQuestion {
  return { ...row, options: z.array(z.string()).parse(row.options) };
}

function expiryOf(body: CreatePilotQuestionInput): Date | null {
  if (body.expiresAt) return new Date(body.expiresAt);
  if (body.kind === "two_factor") return new Date(Date.now() + TWO_FACTOR_TTL_MS);
  return null;
}

@singleton()
export class PilotQuestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly push: PushService,
  ) {}

  async createQuestion(userId: string, body: CreatePilotQuestionInput) {
    const row = await this.prisma.pilotQuestion.create({
      data: {
        userId,
        kind: body.kind,
        subjectType: body.subjectType ?? null,
        subjectId: body.subjectId ?? null,
        prompt: body.prompt,
        options: body.options,
        deepLink: body.deepLink ?? null,
        expiresAt: expiryOf(body),
      },
    });
    const question = toPilotQuestion(row);
    publish(pilotChannel, { userId }, { type: "question.created", question });
    void this.push.sendToUser(userId, {
      title: "OpenApply needs you",
      body: row.prompt,
      url: row.deepLink ?? "/pilot",
      tag: `question-${row.id}`,
    });
    return question;
  }

  /** Unpaginated: the attention panel shows every open question, and there are few. */
  async listQuestions(userId: string, status?: PilotQuestionStatus) {
    const rows = await this.prisma.pilotQuestion.findMany({
      where: { userId, status },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(toPilotQuestion);
  }

  async answerQuestion(userId: string, id: string, body: AnswerPilotQuestionInput) {
    // Expiry publishes no event, so a stale card or push link can still answer an expired question.
    const [row] = await this.prisma.pilotQuestion.updateManyAndReturn({
      where: { id, userId, status: "open" },
      data: { status: "answered", answer: body.answer, answeredAt: new Date() },
    });
    if (!row) {
      await findOwned(
        (where) => this.prisma.pilotQuestion.findFirst({ where }),
        { id, userId },
        "Question",
      );
      throw conflict("Question is no longer open.");
    }

    const question = toPilotQuestion(row);
    publish(pilotChannel, { userId }, { type: "question.answered", question });
    return question;
  }
}
