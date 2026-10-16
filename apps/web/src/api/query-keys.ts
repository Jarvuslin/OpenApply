export const queryKeys = {
  accountSetup: {
    all: ["account-setup"] as const,
    detail: (id: string) => [...queryKeys.accountSetup.all, id] as const,
  },
  telegram: {
    all: ["telegram"] as const,
    status: () => [...queryKeys.telegram.all, "status"] as const,
  },
  jobIntakes: {
    all: ["job-intakes"] as const,
    detail: (id: string) => [...queryKeys.jobIntakes.all, id] as const,
  },
  scoreEvaluations: {
    all: ["score-evaluations"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.scoreEvaluations.all, "list", filters] as const,
    detail: (id: string) => [...queryKeys.scoreEvaluations.all, "detail", id] as const,
    cases: (id: string, filters: Record<string, unknown>) =>
      [...queryKeys.scoreEvaluations.detail(id), "cases", filters] as const,
    report: (id: string) => [...queryKeys.scoreEvaluations.detail(id), "report"] as const,
  },
  answerBank: {
    all: ["answer-bank"] as const,
  },
  needsYou: {
    all: ["needs-you"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.needsYou.all, "list", filters] as const,
    count: () => [...queryKeys.needsYou.all, "count"] as const,
  },
  applicationQuestions: {
    all: ["application-questions"] as const,
    job: (id: string) => [...queryKeys.applicationQuestions.all, id] as const,
    preparation: (id: string) =>
      [...queryKeys.applicationQuestions.job(id), "preparation"] as const,
  },
  pilots: {
    all: ["pilots"] as const,
    list: () => [...queryKeys.pilots.all, "list"] as const,
    detail: (id: string) => [...queryKeys.pilots.all, "detail", id] as const,
    results: (id: string, filters: Record<string, unknown>) =>
      [...queryKeys.pilots.all, "results", id, filters] as const,
    preview: (rules: unknown) => [...queryKeys.pilots.all, "preview", rules] as const,
  },
  queue: {
    all: ["work-queue"] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.queue.all, "list", filters] as const,
    summary: () => [...queryKeys.queue.all, "summary"] as const,
    limits: () => [...queryKeys.queue.all, "limits"] as const,
    detail: (id: string) => [...queryKeys.queue.all, "detail", id] as const,
    timeline: (id: string) => [...queryKeys.queue.all, "timeline", id] as const,
    companion: () => ["queue-companion"] as const,
  },
  auth: {
    all: ["auth"] as const,
    options: () => [...queryKeys.auth.all, "options"] as const,
    me: () => [...queryKeys.auth.all, "me"] as const,
  },

  user: {
    all: ["user"] as const,
    detail: () => [...queryKeys.user.all, "detail"] as const,
  },

  credentials: {
    all: ["credentials"] as const,
    login: () => [...queryKeys.credentials.all, "login"] as const,
  },

  resume: {
    all: ["resume"] as const,
    list: () => [...queryKeys.resume.all, "list"] as const,
    detail: (id: string) => [...queryKeys.resume.all, "detail", id] as const,
    variants: (resumeId: string) =>
      [...queryKeys.resume.all, "variants", "list", resumeId] as const,
    variantDetail: (id: string) => [...queryKeys.resume.all, "variants", "detail", id] as const,
    evidence: (resumeId: string) => [...queryKeys.resume.all, "evidence", resumeId] as const,
    evidenceList: (resumeId: string, filters: Record<string, unknown>) =>
      [...queryKeys.resume.evidence(resumeId), filters] as const,
    artifact: (resumeId: string, variantId: string | undefined, updatedAt: Date | string) =>
      [
        ...queryKeys.resume.all,
        "artifact",
        resumeId,
        variantId ?? "base",
        new Date(updatedAt).getTime(),
      ] as const,
  },

  jobBoards: {
    all: ["job-boards"] as const,
    list: () => [...queryKeys.jobBoards.all, "list"] as const,
    catalog: () => [...queryKeys.jobBoards.all, "catalog"] as const,
  },

  applications: {
    all: ["applications"] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.applications.all, "list", filters] as const,
    summary: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.applications.all, "summary", filters] as const,
    detail: (id: string) => [...queryKeys.applications.all, "detail", id] as const,
    search: (term: string) => [...queryKeys.applications.all, "search", term] as const,
  },

  campaigns: {
    all: ["campaigns"] as const,
    list: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.campaigns.all, "list", filters] as const,
    detail: (campaignId: string) => [...queryKeys.campaigns.all, "detail", campaignId] as const,
    jobs: (campaignId: string, filters: Record<string, unknown> = {}) =>
      [...queryKeys.campaigns.all, "jobs", campaignId, filters] as const,
    reasons: (campaignId: string) => [...queryKeys.campaigns.all, "reasons", campaignId] as const,
    submissionAttempts: (campaignId: string) =>
      [...queryKeys.campaigns.all, "submission-attempt", campaignId] as const,
    submissionAttempt: (campaignId: string, key: string) =>
      [...queryKeys.campaigns.submissionAttempts(campaignId), key] as const,
  },

  email: {
    all: ["email"] as const,
    account: () => [...queryKeys.email.all, "account"] as const,
    messages: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.email.all, "messages", filters] as const,
    message: (id: string) => [...queryKeys.email.all, "message", id] as const,
  },

  workspace: {
    // SSE invalidation namespace for the cross-campaign workspace live-refresh feed.
    all: ["workspace"] as const,
  },

  locations: {
    search: (text: string) => ["locations", "search", text] as const,
  },

  analytics: {
    all: ["analytics"] as const,
    stats: () => [...queryKeys.analytics.all, "stats"] as const,
  },

  pilot: {
    all: ["pilot"] as const,
    questionsAll: () => [...queryKeys.pilot.all, "questions"] as const,
    questions: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.pilot.questionsAll(), filters] as const,

    push: () => [...queryKeys.pilot.all, "push"] as const,
    pushKey: () => [...queryKeys.pilot.push(), "vapid-key"] as const,
  },
} as const;

/** Named invalidation sets for useApiMutation's `invalidate:` option. */
export const invalidations = {
  questions: [
    queryKeys.accountSetup.all,
    queryKeys.answerBank.all,
    queryKeys.needsYou.all,
    queryKeys.applicationQuestions.all,
    queryKeys.pilot.questionsAll(),
    queryKeys.queue.all,
  ],
  queue: [queryKeys.queue.all, queryKeys.campaigns.all, queryKeys.workspace.all],
  pilots: [queryKeys.pilots.all, queryKeys.queue.all],
  resume: [queryKeys.resume.all, queryKeys.user.all],
  campaign: [queryKeys.campaigns.all, queryKeys.workspace.all],
  application: [queryKeys.applications.all, queryKeys.analytics.all],
  // Approving a message can write an application status, so both trees go stale.
  emailReview: [queryKeys.email.all, queryKeys.applications.all, queryKeys.analytics.all],
} as const;
