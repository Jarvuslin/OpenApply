import type { workTimelineEntrySchema } from "@openapply/contracts/work-queue";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { notFound } from "@/common/errors";
import { cleanAgentText } from "@/common/utils/agent-text";
import { PrismaClient } from "@/generated/prisma/client";

type Entry = z.infer<typeof workTimelineEntrySchema>;

const DETAIL_CHARS = 400;

interface TimelineInput {
  item: { createdAt: Date; updatedAt: Date; state: string; reason: string | null; source: string };
  job: {
    title: string;
    company: string;
    board: string | null;
    createdAt: Date;
    score: number | null;
  } | null;
  runs: { startedAt: Date; finishedAt: Date | null; summary: string | null }[];
  asked: { at: Date; count: number }[];
  answered: { at: Date; count: number }[];
  attempt: {
    createdAt: Date;
    startedAt: Date | null;
    receiptStoredAt: Date | null;
    confirmation: string | null;
  } | null;
}

function short(text: string | null) {
  if (!text) return null;
  const clean = cleanAgentText(text).replace(/\s+/g, " ").trim();
  return clean.length > DETAIL_CHARS ? `${clean.slice(0, DETAIL_CHARS - 1)}…` : clean;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Milestones of one application, oldest first; undated ones keep their place in the story. */
export function buildTimeline(input: TimelineInput): Entry[] {
  const { item, job, runs, asked, answered, attempt } = input;
  const entries: Entry[] = [];
  if (job) {
    entries.push({
      kind: "found",
      at: job.createdAt,
      title: `Found ${job.title}${job.company ? ` at ${job.company}` : ""}`,
      detail: job.board,
      automated: true,
    });
    if (job.score !== null)
      entries.push({
        kind: "scored",
        at: null,
        title: `Scored a ${job.score}/100 match against your resume`,
        detail: null,
        automated: true,
      });
  }
  entries.push({
    kind: "queued",
    at: item.createdAt,
    title: "Added to the queue",
    detail: null,
    automated: item.source !== "user" && item.source !== "mvp",
  });
  runs.forEach((run, index) => {
    entries.push({
      kind: "started",
      at: run.startedAt,
      title:
        runs.length > 1 ? `Run ${index + 1}: opened the application` : "Opened the application",
      detail: null,
      automated: true,
    });
    // The last run of a submitted application ends in its confirmation, not a stop.
    const submittedHere =
      attempt?.receiptStoredAt && run.finishedAt && attempt.receiptStoredAt <= run.finishedAt;
    if (run.finishedAt && !submittedHere)
      entries.push({
        kind: "stopped",
        at: run.finishedAt,
        title: runs.length > 1 ? `Run ${index + 1} stopped` : "Run stopped",
        detail: short(run.summary),
        automated: true,
      });
  });
  for (const group of asked)
    entries.push({
      kind: "asked",
      at: group.at,
      title: `Asked you ${plural(group.count, "question")}`,
      detail: null,
      automated: true,
    });
  for (const group of answered)
    entries.push({
      kind: "answered",
      at: group.at,
      title: `You answered ${plural(group.count, "question")}`,
      detail: null,
      automated: false,
    });
  if (attempt) {
    entries.push({
      kind: "reviewed",
      at: attempt.createdAt,
      title: "Reviewed every answer before submitting",
      detail: null,
      automated: true,
    });
    if (attempt.startedAt)
      entries.push({
        kind: "submitting",
        at: attempt.startedAt,
        title: "Clicked Submit",
        detail: null,
        automated: true,
      });
    if (attempt.receiptStoredAt)
      entries.push({
        kind: "confirmed",
        at: attempt.receiptStoredAt,
        title: "Submitted successfully",
        detail: short(attempt.confirmation),
        automated: true,
      });
  }
  if (item.state === "needs_user")
    entries.push({
      kind: "waiting",
      at: item.updatedAt,
      title: "Waiting on you",
      detail: short(item.reason),
      automated: true,
    });
  if (item.state === "failed")
    entries.push({
      kind: "failed",
      at: item.updatedAt,
      title: "Failed",
      detail: short(item.reason),
      automated: true,
    });
  // A stable sort keeps undated entries (the score) right after the step before them.
  let last = 0;
  return entries
    .map((entry) => {
      last = entry.at?.getTime() ?? last;
      return { entry, time: last };
    })
    .sort((a, b) => a.time - b.time)
    .map(({ entry }) => entry);
}

/** Counts per minute, so a form's ten questions read as one step. */
function byMinute(dates: Date[]) {
  const groups = new Map<number, number>();
  for (const date of dates) {
    const minute = Math.floor(date.getTime() / 60_000) * 60_000;
    groups.set(minute, (groups.get(minute) ?? 0) + 1);
  }
  return [...groups].map(([time, count]) => ({ at: new Date(time), count }));
}

@singleton()
export class WorkQueueTimelineService {
  constructor(private readonly prisma: PrismaClient) {}

  async timeline(userId: string, id: string) {
    const item = await this.prisma.workItem.findFirst({ where: { id, userId } });
    if (!item) throw notFound("Work item not found.");
    const job = item.jobId
      ? await this.prisma.job.findUnique({
          where: { id: item.jobId },
          select: { title: true, company: true, board: true, createdAt: true, fitAssessment: true },
        })
      : null;
    const [executions, events, questions, answers, attempt] = await Promise.all([
      this.prisma.workExecution.findMany({
        where: { userId, workItemId: id },
        orderBy: { startedAt: "asc" },
        select: { startedAt: true, finishedAt: true },
      }),
      this.prisma.workEvent.findMany({
        where: { workItemId: id, kind: "text" },
        orderBy: { createdAt: "asc" },
        select: { content: true, createdAt: true },
      }),
      item.jobId
        ? this.prisma.applicationQuestion.findMany({
            where: { userId, jobId: item.jobId },
            select: { createdAt: true },
          })
        : [],
      item.jobId
        ? this.prisma.applicationQuestionAnswer.findMany({
            where: { userId, question: { jobId: item.jobId }, confirmedAt: { not: null } },
            select: { confirmedAt: true },
          })
        : [],
      item.jobId
        ? this.prisma.submissionAttempt.findFirst({
            where: { userId, jobId: item.jobId },
            select: { createdAt: true, startedAt: true, receiptStoredAt: true, receipt: true },
          })
        : null,
    ]);
    const score = (job?.fitAssessment as { score?: unknown } | null)?.score;
    const receipt = attempt?.receipt as { confirmation?: { text?: string } } | null;
    const entries = buildTimeline({
      item,
      job: job ? { ...job, score: typeof score === "number" ? score : null } : null,
      runs: executions.map((run) => ({
        ...run,
        // The agent's last message in a run explains why it stopped.
        summary:
          events
            .filter(
              (event) =>
                event.createdAt >= run.startedAt &&
                (!run.finishedAt || event.createdAt <= new Date(run.finishedAt.getTime() + 5_000)),
            )
            .at(-1)?.content ?? null,
      })),
      asked: byMinute(questions.map((question) => question.createdAt)),
      answered: byMinute(
        answers.flatMap((answer) => (answer.confirmedAt ? [answer.confirmedAt] : [])),
      ),
      attempt: attempt ? { ...attempt, confirmation: receipt?.confirmation?.text ?? null } : null,
    });
    return { entries };
  }
}
