import { campaignConfigSchema } from "@openapply/contracts/campaign";
import type { profileDiscoveryInputSchema } from "@openapply/contracts/job-sources";
import { resumeDataSchema } from "@openapply/contracts/resume";
import { DEFAULT_MIN_MATCH_SCORE, jobPreferencesSchema } from "@openapply/contracts/user";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { conflict, findOwned, unprocessable } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { publishCampaignStatus } from "@/modules/campaign/campaign.utils";
import { OriginalResumeSource } from "@/modules/scoring/original-source";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockDiscovery } from "./candidate-intake";
import { discoverySearches } from "./discovery-plan";

@singleton()
export class ProfileDiscoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scoring: ScoringService,
    private readonly sources: OriginalResumeSource,
  ) {}

  async create(userId: string, input: z.infer<typeof profileDiscoveryInputSchema>) {
    const { config, query } = await this.plan(userId, input);
    const campaign = await this.prisma.campaign.create({
      data: {
        userId,
        query,
        source: input.intent === "apply" ? "auto_apply" : "search",
        config,
        createdBy: "user",
      },
    });
    publishCampaignStatus(userId, campaign, campaign.status);
    return this.view(campaign.campaignId, query, config);
  }

  private async plan(userId: string, input: z.infer<typeof profileDiscoveryInputSchema>) {
    const [user, resume] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { autoApply: true } }),
      findOwned(
        (where) => this.prisma.resume.findFirst({ where }),
        { id: input.resumeId, userId },
        "Original resume",
      ),
    ]);
    if (!resume.sourceFilename)
      throw unprocessable("Choose an original uploaded resume for discovery and scoring.");
    const preferences = jobPreferencesSchema.parse(user.jobPreferences);
    const source = await this.sources.read(resume.sourceFilename);
    const content = resumeDataSchema.safeParse(resume.content);
    const sourceText = source.text.toLowerCase().replace(/\s+/g, " ");
    const suggestedRoles = content.success
      ? [
          ...new Set(
            content.data.experience
              .map((entry) => entry.title)
              .filter((title) => sourceText.includes(title.toLowerCase().replace(/\s+/g, " "))),
          ),
        ].slice(0, 6)
      : [];
    const searches =
      input.searches ??
      discoverySearches(
        preferences,
        z.array(z.string()).parse(JSON.parse(user.preferredLocations)),
        [user.city, user.country].filter(Boolean).join(", "),
        suggestedRoles,
      );
    const config = campaignConfigSchema.parse({
      resumeId: resume.id,
      minScore: user.autoApply?.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE,
      maxJobs: input.maxJobs,
      maxApplications: input.maxApplications,
      discovery: {
        phase: "collecting",
        intent: input.intent,
        searches,
        sources: [],
        completedAt: null,
        reason: null,
      },
    });
    const query = `Profile job list: ${preferences.roles.join(", ") || searches.map((search) => search.query).join(", ")}`;
    return { config, query };
  }

  async initialize(
    userId: string,
    campaignId: string,
    input: { intent: "preview" | "apply"; resumeId?: string },
  ) {
    const campaign = await findOwned(
      (where) => this.prisma.campaign.findFirst({ where }),
      { campaignId, userId },
      "Campaign",
    );
    const existing = campaignConfigSchema.parse(campaign.config);
    if (existing.discovery) return this.view(campaignId, campaign.query, existing);
    if (campaign.status !== "in_progress")
      throw conflict("Only an active empty campaign can initialize a candidate list.");
    const resumeId = input.resumeId ?? existing.resumeId;
    if (!resumeId)
      throw unprocessable("Select an original resume before initializing this candidate list.");
    if (existing.resumeId && input.resumeId && existing.resumeId !== input.resumeId)
      throw conflict("Initialization cannot replace the campaign's selected resume.");
    const { config } = await this.plan(userId, {
      resumeId,
      intent: input.intent,
      maxJobs: Math.min(existing.maxJobs ?? 100, 500),
      maxApplications: Math.min(existing.maxApplications ?? 5, 500),
    });
    const updated = { ...existing, ...config, minScore: existing.minScore ?? config.minScore };
    const changed = await this.prisma.campaign.updateMany({
      where: {
        campaignId,
        userId,
        updatedAt: campaign.updatedAt,
        status: "in_progress",
        jobs: { none: {} },
        applications: { none: {} },
      },
      data: { config: updated, source: input.intent === "apply" ? "auto_apply" : "search" },
    });
    if (!changed.count)
      throw conflict(
        "Only an unchanged empty campaign can initialize discovery; continue existing campaigns without repurposing them.",
      );
    publishCampaignStatus(
      userId,
      { ...campaign, source: input.intent === "apply" ? "auto_apply" : "search" },
      campaign.status,
    );
    return this.view(campaignId, campaign.query, updated);
  }

  async complete(userId: string, campaignId: string, reason: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const { campaign, config } = await lockDiscovery(tx, userId, campaignId);
        const jobs = await tx.job.findMany({ where: { campaignId } });
        let unassessed = 0;
        for (const job of jobs) {
          // Unresolved links stay visibly queued and can never enter the application queue.
          if (job.status === "queued" && !job.description?.trim() && job.retryNotes?.trim()) {
            unassessed++;
            continue;
          }
          const assessment = await this.scoring.currentAssessment(
            userId,
            { campaignId, jobKey: job.key },
            tx,
          );
          let blockedReason: string | null = null;
          if (job.status === "skipped") blockedReason = job.skipReason;
          if (job.status === "failed") blockedReason = job.failReason;
          if (job.status === "needs_user") blockedReason = job.retryNotes;
          if (!assessment?.preferenceChecks && blockedReason?.trim()) {
            unassessed++;
            continue;
          }
          if (!assessment?.preferenceChecks)
            throw conflict(
              `Score every resolved candidate and its preferences before completing discovery; ${job.key} has no complete current original-resume/full-JD assessment.`,
            );
        }
        const explanation = unassessed
          ? `${reason} ${unassessed} candidate(s) remain unassessed with a saved blocker; these are not application-ready.`
          : reason;
        const updated = {
          ...config,
          discovery: {
            ...config.discovery!,
            phase: "complete" as const,
            completedAt: new Date().toISOString(),
            reason: explanation,
          },
        };
        await tx.campaign.update({ where: { campaignId }, data: { config: updated } });
        return { view: this.view(campaignId, campaign.query, updated), campaign };
      },
      { timeout: 60_000 },
    );
    publishCampaignStatus(userId, result.campaign, result.campaign.status);
    return result.view;
  }

  async apply(userId: string, campaignId: string, maxApplications: number) {
    const campaign = await findOwned(
      (where) => this.prisma.campaign.findFirst({ where }),
      { campaignId, userId },
      "Campaign",
    );
    const config = campaignConfigSchema.parse(campaign.config);
    if (config.discovery?.phase !== "complete")
      throw conflict("Finish collecting and scoring this list before applying.");
    if (campaign.status !== "in_progress")
      throw conflict("Resume this campaign before applying from its list.");
    const updated = {
      ...config,
      maxApplications,
      discovery: { ...config.discovery, intent: "apply" as const },
    };
    const changed = await this.prisma.campaign.updateMany({
      where: { campaignId, userId, updatedAt: campaign.updatedAt },
      data: { config: updated, source: "auto_apply" },
    });
    if (!changed.count)
      throw conflict("Candidate list changed concurrently; reload before applying.");
    publishCampaignStatus(userId, { ...campaign, source: "auto_apply" }, campaign.status);
    return this.view(campaignId, campaign.query, updated);
  }

  private view(campaignId: string, query: string, config: z.infer<typeof campaignConfigSchema>) {
    return {
      campaignId,
      query,
      resumeId: config.resumeId!,
      minScore: config.minScore!,
      searches: config.discovery!.searches,
      coverage: config.discovery!,
    };
  }
}
