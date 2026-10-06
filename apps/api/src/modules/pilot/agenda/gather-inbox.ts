import type { AgendaPayload } from "@jobpilot/contracts/pilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { CRASH_OUTCOMES, GATHER_CAP } from "./claims";

const INBOX_BATCH = 10;

/** Answered questions no open or finished claim has consumed yet. */
export async function gatherAnsweredQuestions(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"question.answered">[]> {
  const answered = await prisma.pilotQuestion.findMany({
    where: { userId, status: "answered" },
    orderBy: { answeredAt: "desc" },
    take: GATHER_CAP,
    select: {
      id: true,
      kind: true,
      prompt: true,
      subjectType: true,
      subjectId: true,
      answer: true,
    },
  });
  if (answered.length === 0) return [];

  const claims = await prisma.pilotClaim.findMany({
    where: {
      userId,
      subjectType: "question",
      subjectId: { in: answered.map((question) => question.id) },
      OR: [{ releasedAt: null }, { outcome: { notIn: CRASH_OUTCOMES } }],
    },
    take: GATHER_CAP,
    select: { subjectId: true },
  });
  const consumed = new Set(claims.map((claim) => claim.subjectId));
  return answered
    .filter((question) => !consumed.has(question.id))
    .map(({ id, kind, ...question }) => ({ ...question, questionId: id, questionKind: kind }));
}

/** The oldest unclassified mail, plus how much is waiting in total. */
export async function gatherInbox(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"inbox.review">> {
  const where = { account: { userId }, classification: null, reviewStatus: "pending" } as const;
  const [rows, count] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { receivedAt: "asc" },
      take: INBOX_BATCH,
      select: { id: true },
    }),
    prisma.emailMessage.count({ where }),
  ]);
  return { messageIds: rows.map((row) => row.id), count };
}

/**
 * Interviewing applications whose latest interview email has no reply question yet. An open
 * question is a draft in flight; an answered one was already approved.
 */
export async function gatherInterviewReplies(
  prisma: PrismaClient,
  userId: string,
): Promise<AgendaPayload<"interview.reply">[]> {
  const apps = await prisma.application.findMany({
    where: { userId, status: "interviewing" },
    select: {
      id: true,
      company: true,
      title: true,
      emailMessages: {
        where: { classification: "interviewing" },
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: { id: true, threadId: true, fromAddress: true, subject: true, receivedAt: true },
      },
    },
  });
  const replies = apps.flatMap(({ emailMessages: [email], ...app }) =>
    email
      ? [
          {
            applicationId: app.id,
            emailMessageId: email.id,
            threadId: email.threadId,
            from: email.fromAddress,
            subject: email.subject,
            receivedAt: email.receivedAt,
            company: app.company,
            jobTitle: app.title,
          },
        ]
      : [],
  );
  if (replies.length === 0) return [];

  const questions = await prisma.pilotQuestion.findMany({
    where: {
      userId,
      subjectType: "email",
      subjectId: { in: replies.map((reply) => reply.emailMessageId) },
      status: { in: ["open", "answered"] },
    },
    select: { subjectId: true },
  });
  const handled = new Set(questions.map((question) => question.subjectId));
  return replies.filter((reply) => !handled.has(reply.emailMessageId));
}

/** Interviewing applications without a prep sheet yet. */
