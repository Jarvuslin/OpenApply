import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { singleton } from "tsyringe";
import { badRequest, conflict } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { listingVisibility, sourceVisibility } from "@/modules/job-listing/listing-visibility";
import { PilotJournalService } from "@/modules/pilot/journal.service";
import { enqueueApplications } from "@/modules/work-queue/work-queue.admission";
import { workHash } from "@/modules/work-queue/work-queue.policy";
import { startResult } from "./mvp.schema";

@singleton()
export class ApplyQueueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly journal: PilotJournalService,
  ) {}

  async enqueue(
    userId: string,
    slugs: string[],
    idempotencyKey: string = crypto.randomUUID(),
    provider: "claude" | "codex" = "claude",
  ) {
    const payloadHash = workHash({ source: "mvp", slugs, provider });
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Serialize enqueue requests across API processes, not just this instance.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const prior = await tx.workRequest.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash || !prior.response)
            throw conflict("Apply request was already used with different details.");
          return { ...startResult.parse(prior.response), jobs: [] };
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.firstName || !user.lastName || !user.contactEmail || !user.primaryResumeId)
          throw badRequest("Complete your profile and add a resume before applying.");
        if (
          await tx.pilotQuestion.findFirst({
            where: { userId, subjectType: "onboarding", status: "open" },
            select: { id: true },
          })
        )
          throw badRequest("Answer the pending onboarding questions before applying.");
        const open = await tx.campaign.findMany({
          where: { userId, source: "apply", status: "in_progress" },
          orderBy: { startedAt: "asc" },
        });
        const campaign =
          open.find((row) => campaignConfigSchema.parse(row.config).standing) ??
          (await tx.campaign.create({
            data: {
              userId,
              source: "apply",
              query: "Selected applications",
              createdBy: "user",
              config: { standing: true, resumeId: user.primaryResumeId },
            },
          }));
        const config = campaignConfigSchema.parse(campaign.config);
        const { maxApplications: _cap, ...uncapped } = config;
        await tx.campaign.update({
          where: { campaignId: campaign.campaignId },
          data: { config: { ...uncapped, standing: true, resumeId: user.primaryResumeId } },
        });
        const listings = await tx.jobListing.findMany({
          where: { slug: { in: slugs }, status: "published", ...listingVisibility(userId) },
          include: { sources: { where: sourceVisibility(userId) } },
        });
        const active = await tx.job.findMany({
          where: {
            campaign: { userId },
            status: { in: ["queued", "pending", "approved", "applying", "needs_user", "applied"] },
          },
          select: { url: true, key: true, campaignId: true, status: true },
        });
        const seen = new Set(active.map((job) => canonicalizeJobUrl(job.url)));
        const queued: string[] = [];
        const skipped: { slug: string; reason: string }[] = [];
        const selected = new Set<string>();
        const existingKeys = new Set<string>();
        const writes: Prisma.JobCreateManyInput[] = [];
        for (const slug of slugs) {
          if (selected.has(slug)) {
            skipped.push({ slug, reason: "Duplicate selection" });
            continue;
          }
          selected.add(slug);
          const listing = listings.find((row) => row.slug === slug);
          if (!listing) {
            skipped.push({ slug, reason: "Listing unavailable" });
            continue;
          }
          const source = listing.sources.find((row) => allowedApplyUrl(row.applyUrl));
          const allowed = allowedApplyUrl(source?.applyUrl);
          if (!allowed) {
            skipped.push({ slug, reason: "Employer page not found" });
            continue;
          }
          const url = canonicalizeJobUrl(allowed);
          if (
            seen.has(url) ||
            (await tx.application.findUnique({
              where: { userId_url: { userId, url } },
              select: { id: true },
            }))
          ) {
            const existing = active.find((job) => canonicalizeJobUrl(job.url) === url);
            if (existing?.status === "queued" || existing?.status === "pending") {
              skipped.push({
                slug,
                reason:
                  "Already queued; preparation and approval are still required before applying",
              });
              continue;
            }
            if (
              existing?.campaignId === campaign.campaignId &&
              ["approved", "applying", "needs_user"].includes(existing.status)
            ) {
              existingKeys.add(existing.key);
            }
            skipped.push({ slug, reason: "Already queued or applied" });
            continue;
          }
          seen.add(url);
          writes.push({
            campaignId: campaign.campaignId,
            key: crypto.randomUUID(),
            title: listing.title,
            company: listing.company,
            url,
            location: listing.location,
            board: new URL(url).hostname,
            status: "approved",
            description: listing.descriptionExcerpt,
          });
          queued.push(slug);
        }
        const jobs = writes.length ? await tx.job.createManyAndReturn({ data: writes }) : [];
        const keys = [...existingKeys, ...jobs.map((job) => job.key)];
        const admitted = await tx.job.findMany({
          where: { campaignId: campaign.campaignId, key: { in: keys } },
          select: { id: true },
        });
        const items = admitted.length
          ? await enqueueApplications(tx, userId, {
              idempotencyKey: crypto.randomUUID(),
              jobIds: admitted.map((job) => job.id),
              source: "mvp",
              provider,
            })
          : [];
        const response = {
          workItemIds: items.map((item) => item.id),
          campaignId: campaign.campaignId,
          queued,
          skipped,
          jobKeys: keys,
        };
        await tx.workRequest.create({
          data: {
            userId,
            idempotencyKey,
            payloadHash,
            itemIds: response.workItemIds,
            response: toInputJson(response),
          },
        });
        return { ...response, jobs };
      },
      { timeout: 30_000 },
    );
    for (const job of result.jobs) publishJob(userId, job, "added");
    if (result.queued.length)
      await this.journal.appendJournal(userId, {
        entries: [
          {
            kind: "action",
            subjectType: "campaign",
            subjectId: result.campaignId,
            summary: `Queued ${result.queued.length} selected applications`,
            detail: { queued: result.queued, skipped: result.skipped },
          },
        ],
      });
    const { jobs: _jobs, ...response } = result;
    return response;
  }
}
