import { checkpointApprovalDetailSchema } from "@openapply/contracts/checkpoint-approval";
import type { PilotQuestion as QuestionView } from "@openapply/contracts/pilot/question";
import { z } from "zod/v4";
import type { PilotQuestion } from "@/generated/prisma/client";
export function pilotQuestionView(row: PilotQuestion): QuestionView {
  const approval = row.approval as Record<string, unknown> | null;
  return {
    ...row,
    options: z.array(z.string()).parse(row.options),
    approval: approval
      ? checkpointApprovalDetailSchema.parse({
          ...approval,
          expiresAt: row.expiresAt,
          decision: row.approvalDecision,
          consumedAt: row.approvalConsumedAt,
        })
      : null,
  };
}
