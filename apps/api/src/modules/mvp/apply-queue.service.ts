import { campaignConfigSchema } from "@jobpilot/contracts/campaign";
import { singleton } from "tsyringe";
import { badRequest } from "@/common/errors";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { PilotJournalService } from "@/modules/pilot/journal.service";

@singleton()
export class ApplyQueueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly journal: PilotJournalService,
  ) {}

  async enqueue(userId: string, slugs: string[]) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Serialize enqueue requests across API processes, not just this instance.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
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
          where: { slug: { in: slugs }, status: "published" },
          include: { sources: true },
        });
        const active = await tx.job.findMany({
          where: {
            campaign: { userId },
            status: { in: ["queued", "pending", "approved", "applying", "needs_user", "applied"] },
          },
          select: { url: true },
        });
        const seen = new Set(active.map((job) => canonicalizeJobUrl(job.url)));
        const queued: string[] = [];
        const skipped: { slug: string; reason: string }[] = [];
        const selected = new Set<string>();
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
        return { campaignId: campaign.campaignId, queued, skipped, jobs };
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
