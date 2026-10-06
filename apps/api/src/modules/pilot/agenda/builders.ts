import {
  type AgendaPayload,
  type PilotInstructionsConfig,
  pilotInstructionsConfigSchema,
} from "@openapply/contracts/pilot";
import type { z } from "zod/v4";
import type { AgendaInput } from "./build";
import type { AgendaJob } from "./gather-jobs";

type ConfigOverrides = z.input<typeof pilotInstructionsConfigSchema>;

export const cfg = (over: ConfigOverrides = {}): PilotInstructionsConfig =>
  pilotInstructionsConfigSchema.parse({
    ...over,
  });

const NOW = new Date("2026-07-15T12:00:00.000Z");

export const base = (over: Partial<AgendaInput> = {}): AgendaInput => ({
  now: NOW,
  config: cfg(),
  cycleCount: 0,
  openQuestions: 0,
  activeClaims: 0,
  appliedToday: 0,

  awaitingSetup: true,
  nextSearchRunAt: null,
  answeredQuestions: [],
  approvedJobs: [],

  dueQueries: [],
  scorePending: [],
  queueDrains: [],
  pausedCampaigns: [],
  boardHealth: [],
  inbox: { messageIds: [], count: 0 },
  interviewReplies: [],

  strategyReviews: [],
  rescanSkipped: [],
  retryFailed: [],
  bootstrap: null,
  ...over,
});

export const job = (key: string, matchScore: number | null, over: Partial<AgendaJob> = {}) => ({
  campaignId: "c1",
  key,
  title: `Job ${key}`,
  url: `https://x/${key}`,
  board: null,
  digest: null,
  matchScore,
  company: null,
  ...over,
});

/** A job strong enough for the warm-intro pool. */

export const question = (id: string): AgendaPayload<"question.answered"> => ({
  questionId: id,
  questionKind: "question",
  subjectType: null,
  subjectId: null,
  prompt: "Which start date?",
  answer: "Two weeks",
});

export const reply = (emailMessageId: string): AgendaPayload<"interview.reply"> => ({
  applicationId: `app-${emailMessageId}`,
  emailMessageId,
  threadId: null,
  from: "dana@acme.test",
  subject: "Interview availability?",
  receivedAt: new Date("2026-07-14T12:00:00.000Z"),
  company: "Acme",
  jobTitle: "Engineer",
});

export const boardHealth = (board: string): AgendaPayload<"board.health"> => ({
  board,
  consecutiveFailures: 3,
  recentFailReasons: ["captcha"],
  probeJob: null,
});

export const dueQuery = (query: string, board?: string) => ({
  searchId: `s-${query}`,
  query,
  board,
});

export const pausedCampaign = (campaignId: string): AgendaPayload<"campaign.reviewPaused"> => ({
  campaignId,
  query: "react",
  board: null,
  pausedAt: new Date("2026-07-14T12:00:00.000Z"),
});

export const queueDrain = (campaignId: string): AgendaPayload<"queue.drain"> => ({
  campaignId,
  minScore: 60,
  queuedCount: 1,
  entries: [{ key: "q1", url: "https://x/1" }],
});

export const scorePending = (campaignId: string): AgendaPayload<"campaign.scorePending"> => ({
  campaignId,
  query: "react",
  board: null,
  minScore: 60,
  pendingCount: 9,
  entries: [{ key: "j1", url: "https://x/j1", title: "Engineer" }],
});

export const strategyReview = (campaignId: string): AgendaPayload<"campaign.strategyReview"> => ({
  campaignId,
  query: "react",
  config: { minScore: 70, board: "linkedin" },
  counts: { totalFound: 40, qualified: 4, applied: 1, skipped: 36 },
  topSkipReasons: ["overqualified"],
});

export const bootstrap: AgendaPayload<"strategy.bootstrap"> = {
  goals: "Senior TypeScript roles, remote",
  minScore: 60,
};
