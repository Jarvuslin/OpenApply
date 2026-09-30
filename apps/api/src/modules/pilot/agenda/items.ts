import type { NetworkingMode } from "@jobpilot/contracts/networking";
import type { AgendaItem, AgendaPayload } from "@jobpilot/contracts/pilot";
import { jobSubjectId } from "./claims";
import type { AgendaJob } from "./gather-jobs";

// job.apply adds its matchScore to jobBase, so a perfect match reaches 900.
const PRIORITY = {
  question: 1000,
  interviewReply: 950,
  // Above any apply: probe a failing board before more attempts pile onto it.
  boardHealth: 920,
  // Above any apply, or a full apply agenda would starve a stranded campaign out of the top 10.
  reviewPaused: 910,
  jobBase: 800,
  interviewPrep: 750,
  queueDrain: 720,
  networkingSend: 700,
  inboxReview: 650,
  upworkSync: 640,
  promoPost: 600,
  warmIntro: 550,
  strategyBootstrap: 520,
  // Finish scoring what was found before discovering more.
  scorePending: 510,
  discover: 500,
  followup: 400,
  strategyReview: 350,
  promoCompose: 300,
  rescanSkipped: 250,
  retryFailed: 240,
} as const;

export const questionItem = (payload: AgendaPayload<"question.answered">): AgendaItem => ({
  id: `question.answered:${payload.questionId}`,
  kind: "question.answered",
  priority: PRIORITY.question,
  title: `Apply answer: ${payload.prompt}`,
  subjectType: "question",
  subjectId: payload.questionId,
  payload,
});

export const applyItem = (job: AgendaJob): AgendaItem => ({
  id: `job.apply:${jobSubjectId(job)}`,
  kind: "job.apply",
  priority: PRIORITY.jobBase + (job.matchScore ?? 0),
  title: job.title,
  subjectType: "job",
  subjectId: jobSubjectId(job),
  payload: {
    campaignId: job.campaignId,
    jobKey: job.key,
    url: job.url,
    board: job.board,
    digest: job.digest,
    resumeId: job.resumeId,
    matchScore: job.matchScore,
    warmContacts: job.warmContacts,
  },
});

/** An empty contact list still earns the item: the worker finding a first contact is the point. */
export const warmIntroItem = (job: AgendaJob, mode: NetworkingMode): AgendaItem => ({
  id: `networking.warmIntro:${jobSubjectId(job)}`,
  kind: "networking.warmIntro",
  priority: PRIORITY.warmIntro,
  title: `Warm intro: ${job.title}`,
  subjectType: "networking",
  subjectId: jobSubjectId(job),
  payload: {
    campaignId: job.campaignId,
    jobKey: job.key,
    company: job.company,
    jobTitle: job.title,
    jobUrl: job.url,
    contacts: job.warmContacts ?? [],
    ...mode,
  },
});

export const discoverItem = (payload: AgendaPayload<"search.discover">): AgendaItem => ({
  id: `search.discover:${payload.searchId}`,
  kind: "search.discover",
  priority: PRIORITY.discover,
  title: `Discover: ${payload.query}`,
  subjectType: "campaign",
  subjectId: payload.searchId,
  payload,
});

export const scorePendingItem = (payload: AgendaPayload<"campaign.scorePending">): AgendaItem => ({
  id: `campaign.scorePending:${payload.campaignId}`,
  kind: "campaign.scorePending",
  priority: PRIORITY.scorePending,
  title: `Score discovered jobs: ${payload.query}`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const reviewPausedItem = (payload: AgendaPayload<"campaign.reviewPaused">): AgendaItem => ({
  id: `campaign.reviewPaused:${payload.campaignId}`,
  kind: "campaign.reviewPaused",
  priority: PRIORITY.reviewPaused,
  title: `Review paused campaign: ${payload.query}`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const queueDrainItem = (payload: AgendaPayload<"queue.drain">): AgendaItem => ({
  id: `queue.drain:${payload.campaignId}`,
  kind: "queue.drain",
  priority: PRIORITY.queueDrain,
  title: `Score ${payload.queuedCount} pasted link(s)`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const networkingSendItem = (payload: AgendaPayload<"networking.send">): AgendaItem => ({
  id: `networking.send:${payload.messageId}`,
  kind: "networking.send",
  priority: PRIORITY.networkingSend,
  title: `Send networking message: ${payload.contactName}`,
  subjectType: "networking",
  subjectId: payload.messageId,
  payload,
});

export const followupItem = (payload: AgendaPayload<"networking.followup">): AgendaItem => ({
  id: `networking.followup:${payload.messageId}`,
  kind: "networking.followup",
  priority: PRIORITY.followup,
  title: `Follow up: ${payload.contactName}`,
  subjectType: "networking",
  subjectId: payload.messageId,
  payload,
});

export const inboxItem = (payload: AgendaPayload<"inbox.review">): AgendaItem => ({
  id: "inbox.review",
  kind: "inbox.review",
  priority: PRIORITY.inboxReview,
  title: `Review ${payload.count} inbox message(s)`,
  subjectType: "inbox",
  subjectId: "inbox",
  payload,
});

export const interviewReplyItem = (payload: AgendaPayload<"interview.reply">): AgendaItem => ({
  id: `interview.reply:${payload.emailMessageId}`,
  kind: "interview.reply",
  priority: PRIORITY.interviewReply,
  title: `Reply to interview invite: ${payload.company}`,
  subjectType: "email",
  subjectId: payload.emailMessageId,
  payload,
});

export const interviewPrepItem = (payload: AgendaPayload<"interview.prep">): AgendaItem => ({
  id: `interview.prep:${payload.applicationId}`,
  kind: "interview.prep",
  priority: PRIORITY.interviewPrep,
  title: `Interview prep: ${payload.jobTitle}`,
  subjectType: "application",
  subjectId: payload.applicationId,
  payload,
});

export const promoPostItem = (payload: AgendaPayload<"promo.post">): AgendaItem => ({
  id: `promo.post:${payload.promotionId}`,
  kind: "promo.post",
  priority: PRIORITY.promoPost,
  title: `Post to ${payload.platform}`,
  subjectType: "promotion",
  subjectId: payload.promotionId,
  payload,
});

export const promoComposeItem = (payload: AgendaPayload<"promo.compose">): AgendaItem => ({
  id: `promo.compose:${payload.platform}`,
  kind: "promo.compose",
  priority: PRIORITY.promoCompose,
  title: `Compose post: ${payload.platform}`,
  subjectType: "promotion",
  subjectId: `platform:${payload.platform}`,
  payload,
});

export const upworkSyncItem = (payload: AgendaPayload<"upwork.syncInbox">): AgendaItem => ({
  id: "upwork.syncInbox",
  kind: "upwork.syncInbox",
  priority: PRIORITY.upworkSync,
  title: payload.lastSyncedAt ? "Refresh the Upwork inbox" : "Pull the Upwork inbox",
  subjectType: "upwork",
  subjectId: "inbox",
  payload,
});

export const boardHealthItem = (payload: AgendaPayload<"board.health">): AgendaItem => ({
  id: `board.health:${payload.board}`,
  kind: "board.health",
  priority: PRIORITY.boardHealth,
  title: `Board failing: ${payload.board} (${payload.consecutiveFailures})`,
  subjectType: "board",
  subjectId: payload.board,
  payload,
});

export const strategyReviewItem = (
  payload: AgendaPayload<"campaign.strategyReview">,
): AgendaItem => ({
  id: `campaign.strategyReview:${payload.campaignId}`,
  kind: "campaign.strategyReview",
  priority: PRIORITY.strategyReview,
  title: `Review strategy: ${payload.query}`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const rescanSkippedItem = (payload: AgendaPayload<"job.rescanSkipped">): AgendaItem => ({
  id: `job.rescanSkipped:${payload.campaignId}`,
  kind: "job.rescanSkipped",
  priority: PRIORITY.rescanSkipped,
  title: `Rescan ${payload.skippedCount} skipped job(s)`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const retryFailedItem = (payload: AgendaPayload<"job.retryFailed">): AgendaItem => ({
  id: `job.retryFailed:${payload.campaignId}`,
  kind: "job.retryFailed",
  priority: PRIORITY.retryFailed,
  title: `Retry ${payload.failedCount} failed job(s)`,
  subjectType: "campaign",
  subjectId: payload.campaignId,
  payload,
});

export const bootstrapItem = (payload: AgendaPayload<"strategy.bootstrap">): AgendaItem => ({
  id: "strategy.bootstrap",
  kind: "strategy.bootstrap",
  priority: PRIORITY.strategyBootstrap,
  title: "Set up searches from your goals",
  subjectType: "pilot",
  subjectId: "bootstrap",
  payload,
});
