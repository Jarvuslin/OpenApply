import { z } from "zod/v4";

const gmailCheckResultSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  status: z.enum(["connected", "read_access", "needs_user", "error"]),
  mailbox: z.string().nullable(),
  message: z.string().max(2000),
  action: z
    .enum([
      "connect_gmail",
      "sign_in",
      "switch_account",
      "switch_provider",
      "confirm_mailbox",
      "retry",
    ])
    .nullable(),
});

export type GmailCheckResult = z.infer<typeof gmailCheckResultSchema>;

/** A check for one mailbox must never save a different account returned by the local agent. */
export function parseGmailCheckResult(
  value: unknown,
  provider: "claude" | "codex",
  expectedEmail: string,
): GmailCheckResult {
  const result = gmailCheckResultSchema.parse(value);
  if (result.provider !== provider) throw new Error("The check returned a different agent. Retry.");
  if (result.status === "read_access") {
    if (result.mailbox !== null || result.action !== "confirm_mailbox") {
      throw new Error("The Gmail check returned an invalid mailbox confirmation. Retry.");
    }
    return result;
  }
  if (result.status !== "connected") return result;
  const mailbox = z.email().parse(result.mailbox).toLowerCase();
  if (mailbox !== expectedEmail.trim().toLowerCase()) {
    return {
      ...result,
      status: "needs_user",
      mailbox,
      action: "switch_account",
      message: `Your agent is connected to ${mailbox}, but you requested ${expectedEmail}. Switch Gmail accounts in your provider, then retry. No mailbox was added.`,
    };
  }
  return { ...result, mailbox };
}
