import type { PrismaClient } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { type RetentionCutoffs, resumeVariantWhere } from "./retention";

export async function deleteUnselectedVariants(prisma: PrismaClient, cutoffs: RetentionCutoffs) {
  const candidates = await prisma.resumeVariant.findMany({
    where: resumeVariantWhere(cutoffs),
    select: { resume: { select: { userId: true } } },
    distinct: ["resumeId"],
  });
  let count = 0;
  for (const userId of [
    ...new Set(candidates.map((candidate) => candidate.resume.userId)),
  ].sort()) {
    count += await prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const selections = await tx.applicationDocumentSelection.findMany({
        where: { userId, current: true, variantId: { not: null } },
        select: { variantId: true },
      });
      const ids = selections.flatMap((selection) =>
        selection.variantId ? [selection.variantId] : [],
      );
      const removed = await tx.resumeVariant.deleteMany({
        where: { ...resumeVariantWhere(cutoffs), resume: { userId }, id: { notIn: ids } },
      });
      return removed.count;
    });
  }
  return { count };
}
