import { z } from "zod/v4";
import type { WorkItem } from "./work-queue";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ACCOUNT_SETUP_OUTCOMES = [
  "created",
  "already_exists",
  "verification_pending",
  "blocked",
  "ambiguous",
] as const;
export const accountSetupSnapshotSchema = z.strictObject({
  version: z.literal(2),
  revision: z.number().int().positive(),
  operation: z.enum(["signup", "inspect"]),
  credentialRevision: hash,
  purpose: z.literal("account_setup"),
  workItemId: z.uuid(),
  provider: z.literal("claude"),
  signupUrl: z.url().max(4000),
  tenantOrigin: z.url().max(4000),
  credentialId: z.uuid(),
  email: z.email().max(320),
  accountStatus: z.enum(["unknown", "absent_confirmed"]),
  maxSignupAttempts: z.literal(1),
  submissionAllowed: z.literal(false),
  snapshotHash: hash,
});
const mailboxConfirmationSchema = z.strictObject({
  email: z.email().max(320),
  basis: z.literal("user_confirmed"),
});
export const enqueueAccountSetupSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  signupUrl: z.url().max(4000),
  tenantOrigin: z.url().max(4000),
  credentialId: z.uuid(),
  email: z.email().max(320),
  accountStatus: z.enum(["unknown", "absent_confirmed"]).default("unknown"),
  mailboxConfirmation: mailboxConfirmationSchema.optional(),
});
const accountSetupAttemptSchema = z.strictObject({
  signupAttempts: z.union([z.literal(0), z.literal(1)]),
  begunAt: z.date().nullable(),
  outcome: z.enum(ACCOUNT_SETUP_OUTCOMES).nullable(),
  observedAt: z.date().nullable(),
  phase: z.enum([
    "checking",
    "signup_ready",
    "signup_started",
    "verification_pending",
    "needs_user",
    "authenticated",
    "unknown",
    "skipped",
  ]),
  reason: z
    .enum([
      "existing_account_credentials",
      "password_entry",
      "terms_confirmation",
      "mailbox_identity",
      "verification",
      "captcha",
    ])
    .nullable(),
  questionId: z.uuid().nullable(),
  browserSessionId: z.uuid().nullable(),
  currentUrl: z.url().nullable(),
  existingAccount: z.boolean(),
  noAccountObserved: z.boolean(),
  credentialPurpose: z.enum(["signup", "existing", "authenticated"]),
  authenticatedAt: z.date().nullable(),
  mailbox: z
    .strictObject({
      email: z.email(),
      basis: z.enum(["user_confirmed", "provider_verified"]),
      confirmedAt: z.date(),
    })
    .nullable(),
  mailboxBlocked: z.boolean(),
  verification: z
    .strictObject({
      requestedAt: z.date(),
      recipient: z.email(),
      tenantOrigin: z.url(),
      senderDomains: z.array(z.string().min(1).max(253)).min(1).max(10),
    })
    .nullable(),
});
export const accountSetupContextSchema = z.strictObject({
  snapshot: accountSetupSnapshotSchema,
  attempt: accountSetupAttemptSchema,
});
export const accountSetupExecutionSchema = z.strictObject({
  snapshot: accountSetupSnapshotSchema,
  apiToken: z.string().min(1),
});
export const accountSetupCredentialSchema = z.strictObject({
  credentialId: z.uuid(),
  email: z.email(),
  password: z.string().min(1),
});
export const accountSetupBeginSchema = z.strictObject({});
const pageObservation = { browserSessionId: z.uuid(), currentUrl: z.url().max(4000) };
export const accountSetupObserveSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.enum([
      "signup_form",
      "no_account",
      "existing_account",
      "credentials_rejected",
      "unknown",
    ]),
    ...pageObservation,
  }),
  z.strictObject({
    event: z.literal("authenticated"),
    evidence: z.literal("authenticated_session"),
    ...pageObservation,
  }),
  z.strictObject({
    event: z.literal("needs_user"),
    reason: accountSetupAttemptSchema.shape.reason.unwrap(),
    ...pageObservation,
  }),
  z.strictObject({
    event: z.literal("verification_pending"),
    requestedAt: z.iso.datetime(),
    recipient: z.email(),
    senderDomains: z
      .array(z.string().regex(/^[a-z0-9.-]+$/))
      .min(1)
      .max(10),
    ...pageObservation,
  }),
  z.strictObject({
    event: z.literal("mailbox_status"),
    status: z.enum(["provider_verified", "mismatch", "authorization_failed"]),
    email: z.email(),
    ...pageObservation,
  }),
]);
/** An application worker at a signup wall asks for the account; its job waits until it exists. */
export const requestAccountSetupSchema = z.strictObject({
  signupUrl: z.url().max(4000),
  tenantOrigin: z.url().max(4000),
});
export const requestAccountSetupResultSchema = z.strictObject({
  accountWorkItemId: z.uuid(),
  phase: accountSetupAttemptSchema.shape.phase,
});
export const accountSetupContinueSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  action: z.enum(["continue", "skip"]),
  mailboxConfirmation: mailboxConfirmationSchema.optional(),
});
export const accountSetupSaveCredentialsSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  password: z.string().min(1).max(1024),
});

export type AccountSetupContext = z.infer<typeof accountSetupContextSchema>;
export type AccountSetupDetail = { item: WorkItem; context: AccountSetupContext };
export type AccountSetupObservation = z.infer<typeof accountSetupObserveSchema>;
export type AccountSetupContinue = z.infer<typeof accountSetupContinueSchema>;
export type AccountSetupSnapshot = z.infer<typeof accountSetupSnapshotSchema>;
export type EnqueueAccountSetup = z.infer<typeof enqueueAccountSetupSchema>;
export type RequestAccountSetup = z.infer<typeof requestAccountSetupSchema>;
