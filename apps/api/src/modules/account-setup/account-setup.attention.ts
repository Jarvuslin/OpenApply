import type { AccountSetupContext } from "@openapply/contracts/account-setup";
import { toInputJson } from "@/common/json";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { storedAccountSetup } from "./account-setup.snapshot";

export async function askAccountQuestion(
  tx: Prisma.TransactionClient,
  item: WorkItem,
  context: AccountSetupContext,
) {
  if (context.attempt.questionId) return;
  const question = await tx.pilotQuestion.create({
    data: {
      userId: item.userId,
      kind: "choice",
      subjectType: "account_setup",
      subjectId: item.id,
      prompt:
        context.attempt.reason === "existing_account_credentials"
          ? "An employer account already exists. Save its password securely in OpenApply or skip. Never send passwords in chat or Telegram."
          : "This employer account needs your review. Complete the indicated browser or verification step, then continue securely in OpenApply or skip.",
      options: ["Open secure account review", "Skip"],
      deepLink: `/account-setup/${item.id}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  context.attempt.questionId = question.id;
}

export async function parkAccountSetup(tx: Prisma.TransactionClient, item: WorkItem) {
  const context = storedAccountSetup(item);
  if (["authenticated", "skipped"].includes(context.attempt.phase)) return context;
  if (!["needs_user", "unknown", "verification_pending"].includes(context.attempt.phase)) {
    context.attempt.phase = "unknown";
    context.attempt.reason = "verification";
    context.attempt.outcome = "ambiguous";
    context.attempt.observedAt = new Date();
  }
  await askAccountQuestion(tx, item, context);
  await tx.workItem.update({ where: { id: item.id }, data: { payload: toInputJson(context) } });
  return context;
}
