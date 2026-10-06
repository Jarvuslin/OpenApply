import type { CampaignJobReason } from "@openapply/contracts/campaign";
import { pageSlice, paginate } from "@openapply/contracts/pagination";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { ensureCampaignOwned } from "../campaign.utils";
import type { campaignJobsQuery } from "./job.schema";

@singleton()
export class CampaignJobQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async listJobs(userId: string, campaignId: string, query: z.infer<typeof campaignJobsQuery>) {
    const where: Prisma.JobWhereInput = {
      campaignId,
      campaign: { userId },
      status: query.status,
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: "insensitive" } },
          { company: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };
    // The page is already ownership-scoped; the probe only tells a 404 from an empty page.
    const [, jobs, total] = await Promise.all([
      ensureCampaignOwned(this.prisma, userId, campaignId),
      this.prisma.job.findMany({ where, orderBy: { createdAt: "asc" }, ...pageSlice(query) }),
      this.prisma.job.count({ where }),
    ]);
    return paginate(jobs, query, total);
  }

  /** Grouped across every job, so the breakdown is not page-scoped. */
  async listJobReasons(userId: string, campaignId: string): Promise<CampaignJobReason[]> {
    await ensureCampaignOwned(this.prisma, userId, campaignId);

    const [skipped, failed] = await Promise.all([
      this.prisma.job.groupBy({
        by: ["skipReason"],
        where: { campaignId, status: "skipped", skipReason: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ["failReason"],
        where: { campaignId, status: "failed", failReason: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return [
      ...skipped.map((row) => ({
        kind: "skipped" as const,
        reason: row.skipReason ?? "",
        count: row._count._all,
      })),
      ...failed.map((row) => ({
        kind: "failed" as const,
        reason: row.failReason ?? "",
        count: row._count._all,
      })),
    ].sort((a, b) => b.count - a.count);
  }
}
