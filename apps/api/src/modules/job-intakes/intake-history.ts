import { pageSlice } from "@openapply/contracts/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { canonicalizeIntakeUrl } from "@/modules/application/job-url";

export async function hasIntakeApplication(
  tx: Prisma.TransactionClient,
  userId: string,
  urls: string[],
) {
  for (let page = 1; ; page++) {
    const rows = await tx.application.findMany({
      where: { userId },
      select: { url: true },
      orderBy: [{ appliedAt: "desc" }, { id: "asc" }],
      ...pageSlice({ page, limit: 100 }),
    });
    if (rows.some((row) => urls.includes(canonicalizeIntakeUrl(row.url)))) return true;
    if (rows.length < 100) return false;
  }
}

export async function existingIntakeJob(
  tx: Prisma.TransactionClient,
  userId: string,
  urls: string[],
) {
  for (let page = 1; ; page++) {
    const rows = await tx.job.findMany({
      where: { campaign: { userId } },
      include: { workItem: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...pageSlice({ page, limit: 100 }),
    });
    const found = rows.find((row) => urls.includes(canonicalizeIntakeUrl(row.url)));
    if (found) return found;
    if (rows.length < 100) return null;
  }
}
