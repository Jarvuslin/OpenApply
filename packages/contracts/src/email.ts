import { z } from "zod/v4";
import { type ApplicationStatus, statusSchema } from "./application";

export const EMAIL_PROVIDERS = ["gmail", "outlook", "imap", "connector"] as const;
export const emailProviderSchema = z.enum(EMAIL_PROVIDERS);

export const EMAIL_RUNTIME_PROVIDERS = ["claude", "codex"] as const;
export const emailRuntimeProviderSchema = z.enum(EMAIL_RUNTIME_PROVIDERS);
const mailboxAddressSchema = z.string().trim().toLowerCase().pipe(z.email());

export const registerConnectorAccountSchema = z.object({
  mailbox: mailboxAddressSchema,
  runtimeProvider: emailRuntimeProviderSchema,
  identityVerified: z.boolean().default(false),
});
export type RegisterConnectorAccountInput = z.input<typeof registerConnectorAccountSchema>;

export const CLASSIFICATIONS = [
  "interviewing",
  "rejected",
  "offer",
  "irrelevant",
  "verification",
] as const;
export const classificationSchema = z.enum(CLASSIFICATIONS);

/** Maps an approvable inbox classification to the application status it moves to. */
export const CLASSIFICATION_TO_STATUS: Partial<Record<Classification, ApplicationStatus>> = {
  interviewing: "interviewing",
  rejected: "rejected",
  offer: "offer",
};

export const REVIEW_STATUSES = ["pending", "approved", "denied", "auto"] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const scanMessageSchema = z.object({
  classification: classificationSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  matchedAppId: z.uuid().optional().nullable(),
  matchScore: z.number().min(0).max(1).optional().nullable(),
  appliedStatus: statusSchema.optional().nullable(),
  reviewStatus: reviewStatusSchema.optional(),
  verificationCode: z.string().optional().nullable(),
  verificationLink: z.string().optional().nullable(),
  verificationDomain: z.string().optional().nullable(),
});

export const approveSchema = z.object({
  toStatus: statusSchema.optional(),
  note: z.string().optional().nullable(),
});

export type Classification = z.infer<typeof classificationSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ScanMessageInput = z.infer<typeof scanMessageSchema>;
export type ApproveInput = z.infer<typeof approveSchema>;

export const ingestMessagesSchema = z.object({
  mailbox: mailboxAddressSchema,
  accountId: z.uuid().optional(),
  runtimeProvider: emailRuntimeProviderSchema.optional(),
  messages: z
    .array(
      z
        .object({
          providerId: z.string().min(1).max(500),
          threadId: z.string().max(500).nullable(),
          subject: z.string().max(2000),
          fromAddress: z.email().toLowerCase(),
          toHeader: z.string().max(4000).nullish(),
          fromName: z.string().max(1000).nullable(),
          fromDomain: z.string().min(1).max(253).toLowerCase(),
          snippet: z.string().max(5000),
          rawBody: z.string().max(100000),
          receivedAt: z.coerce.date(),
        })
        .refine(
          (m) => m.fromDomain === m.fromAddress.split("@")[1],
          "Sender domain must match the sender address",
        ),
    )
    .max(100),
});
export type IngestMessagesInput = z.infer<typeof ingestMessagesSchema>;
