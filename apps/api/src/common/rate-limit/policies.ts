import { byEmail, byEmailAndIp, byIp, byUser, type RateLimitPolicy } from "./limiter";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every limit in one place. Sized for a human at a keyboard plus a generous multiple for a shared
 * NAT, never for a script's happy path. `/auth/logout` gets none - it is idempotent, and throttling
 * it could only strand a user half-logged-out.
 */
export const RATE_LIMITS = {
  workQueueRead: { key: byUser, limit: 1200, windowMs: HOUR, burst: 80 },
  // Three visible workers at a two-second frame cadence, with bounded refresh headroom.
  workQueueObserver: { key: byUser, limit: 7200, windowMs: HOUR, burst: 20 },
  workQueueMutation: { key: byUser, limit: 240, windowMs: HOUR, burst: 20 },
  workQueueRuntime: { key: byUser, limit: 3600, windowMs: HOUR, burst: 100 },
  discoverRead: { key: byUser, limit: 360, windowMs: MINUTE },
  discoverSave: { key: byUser, limit: 120, windowMs: MINUTE },
  discoverRefresh: { key: byUser, limit: 3, windowMs: MINUTE, maxInFlight: 1 },
  discoverSearch: { key: byUser, limit: 20, windowMs: HOUR, maxInFlight: 1 },
  evidenceRead: { key: byUser, limit: 360, windowMs: MINUTE },
  evidenceMutation: { key: byUser, limit: 120, windowMs: MINUTE },
  mailboxIngest: { key: byUser, limit: 120, windowMs: MINUTE, maxInFlight: 1 },
  applyQueue: { key: byUser, limit: 30, windowMs: MINUTE, maxInFlight: 1 },
  localExtraction: { key: byUser, limit: 10, windowMs: HOUR, maxInFlight: 1 },
  resumeCompile: { key: byUser, limit: 60, windowMs: HOUR, maxInFlight: 1 },
  resumeArtifactRead: { key: byUser, limit: 180, windowMs: MINUTE },
  /** Credential stuffing against one account. Keyed by (email, IP) so one bad actor can't lock out
   *  everyone else behind the same office/CGNAT address. */
  loginPerAccount: {
    key: byEmailAndIp,
    limit: 5,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in attempts for this account. Try again in a few minutes.",
  },

  /** Password spraying: many emails from one host. Loose, so a real office never trips it. */
  loginPerIp: { key: byIp, limit: 30, windowMs: 15 * MINUTE },

  /** Account farming. A human registers once; 5/hour still covers a family or a demo booth. */
  register: { key: byIp, limit: 5, windowMs: HOUR },

  /** Sends mail, so it can be weaponized to spam a victim. Per-IP stops a script; per-email stops a
   *  distributed mail-bomb on one address. */
  forgotPerIp: { key: byIp, limit: 5, windowMs: HOUR },
  forgotPerEmail: { key: byEmail, limit: 3, windowMs: HOUR },

  /** Magic-link endpoints. The tokens are high-entropy, so this caps the cost of hammering the DB
   *  lookup - it is not what makes guessing infeasible. */
  passwordReset: { key: byIp, limit: 10, windowMs: HOUR },
  emailVerify: { key: byIp, limit: 20, windowMs: HOUR },

  /** Authed, but sends mail on every call, so the axis is the known caller. */
  emailResend: {
    key: byUser,
    limit: 3,
    windowMs: HOUR,
    message: "Verification email already sent. Check your inbox, then try again later.",
  },

  /** Cheap and cookie-driven; exists only so a broken client retry loop can't spin the DB. */
  refresh: { key: byIp, limit: 60, windowMs: 15 * MINUTE },

  /** OAuth start + callback: public redirects, so keyed by IP; loose enough for retries. */
  oauthStart: { key: byIp, limit: 20, windowMs: 15 * MINUTE },

  /** Caps a stolen session brute-forcing the current password. */
  passwordChange: { key: byUser, limit: 10, windowMs: HOUR },

  /** Sends mail to an arbitrary address the caller typed, so tight like emailResend. */
  emailChange: { key: byUser, limit: 3, windowMs: HOUR },

  /** Magic-link consumption; same shape as passwordReset (high-entropy token, DB-cost cap). */
  emailChangeConfirm: { key: byIp, limit: 10, windowMs: HOUR },

  /** Sized for a crawler walking the paginated public job index, not just a human browsing it -
   *  too tight here and we deindex ourselves. A scraper brake, not an anti-abuse wall. */
  publicJobs: { key: byIp, limit: 1800, windowMs: HOUR, burst: 120 },

  /** Burns the *user's own* solver credits (captcha.service.ts decrypts their key), so this is a
   *  runaway-agent guardrail, not an anti-abuse wall. burst 5 covers a page with several challenges.
   *  `maxInFlight` because a rate cap alone still lets several two-minute solves pile up on sockets. */
  captchaSolve: {
    key: byUser,
    limit: 60,
    windowMs: HOUR,
    burst: 5,
    maxInFlight: 2,
    message: "Too many CAPTCHA solves in flight. Slow the loop down.",
  },

  /** Pilots pages: the list and a running pilot poll every few seconds, two queries each. */
  pilotsRead: { key: byUser, limit: 3600, windowMs: HOUR, burst: 60 },

  /** The set up wizard's live match count, debounced on the client but fired per rule change. */
  pilotsPreview: { key: byUser, limit: 1200, windowMs: HOUR, burst: 20 },

  /** Run, stop, edit and bulk add/remove on pilots - clicks, never a loop. */
  pilotsMutation: { key: byUser, limit: 600, windowMs: HOUR, burst: 30 },

  /** Pilot polls the agenda once per cycle; burst covers a tight claim-then-repoll loop. */
  pilotAgenda: { key: byUser, limit: 240, windowMs: HOUR, burst: 10 },

  /** Batched journal writes, several per cycle - the loosest Pilot limit. */
  pilotJournal: { key: byUser, limit: 600, windowMs: HOUR, burst: 20 },

  /** Full-history NDJSON export - heavy (streams every row), user-initiated, rarely needed. */
  pilotJournalExport: { key: byUser, limit: 10, windowMs: HOUR },

  /** User- or agent-driven Pilot mutations (instructions, enable, questions) - infrequent. */
  pilotMutation: { key: byUser, limit: 120, windowMs: HOUR },

  questionRead: { key: byUser, limit: 600, windowMs: HOUR },
  questionMutation: { key: byUser, limit: 240, windowMs: HOUR },
  submissionUpload: { key: byUser, limit: 120, windowMs: HOUR, maxInFlight: 1 },
} as const satisfies Record<string, RateLimitPolicy>;
