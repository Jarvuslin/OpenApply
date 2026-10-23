import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { intakePreparationSnapshotSchema } from "@openapply/contracts/intake-preparation";
import { workItemSchema } from "@openapply/contracts/work-queue";
import { z } from "zod/v4";
import { notFound } from "@/common/errors";
import { hasSubmissionScreenshot } from "@/common/storage/storage";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { storedPreparation } from "@/modules/intake-preparation/preparation.snapshot";

const legacyPreparationIdentity = z.strictObject({
  intakeId: z.uuid(),
  jobIds: z.array(z.uuid()).length(1),
});

export async function workItemView(tx: Prisma.TransactionClient, userId: string, item: WorkItem) {
  if (item.userId !== userId) throw notFound("Owned work item not found.");
  let intakeId: string | null = null;
  if (item.kind === "pilot_task" && item.intent === "intake_prepare") {
    let binding: { intakeId: string; jobId: string } | null = null;
    if (intakePreparationSnapshotSchema.safeParse(item.payload).success) {
      try {
        binding = storedPreparation(item);
      } catch {
        binding = null;
      }
    } else {
      const legacy = legacyPreparationIdentity.safeParse(item.payload);
      if (legacy.success)
        binding = { intakeId: legacy.data.intakeId, jobId: legacy.data.jobIds[0] };
    }
    if (binding) {
      const intake = await tx.jobIntake.findFirst({
        where: { id: binding.intakeId, userId },
        select: { id: true, jobId: true, job: { select: { campaignId: true } } },
      });
      if (
        intake &&
        (!intake.jobId ||
          (intake.jobId === binding.jobId && intake.job?.campaignId === item.campaignId))
      )
        intakeId = intake.id;
    }
  }
  const job = item.jobId
    ? await tx.job.findUnique({
        where: { id: item.jobId },
        select: {
          url: true,
          matchScore: true,
          campaign: { select: { config: true } },
          documentSelections: {
            where: { current: true },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { resumeId: true },
          },
        },
      })
    : null;
  // Optional chains also cover the flat job rows the queue test fakes return.
  const resumeId =
    job?.documentSelections?.[0]?.resumeId ??
    campaignConfigSchema.safeParse(job?.campaign?.config).data?.resumeId;
  const resume = resumeId
    ? await tx.resume.findFirst({ where: { id: resumeId, userId }, select: { label: true } })
    : null;
  const hasScreenshot = item.kind === "application" && (await hasSubmissionScreenshot(item.id));
  return workItemSchema.parse({
    ...item,
    intakeId,
    url: job?.url ?? null,
    matchScore: job?.matchScore ?? null,
    resumeLabel: resume?.label ?? null,
    hasScreenshot,
  });
}
