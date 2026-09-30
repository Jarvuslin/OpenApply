import {
  type CampaignStatusCommandInput,
  type CampaignSummary,
  type CreateCampaignInput,
  campaignConfigSchema,
  campaignConfigSupportsSource,
  type UpdateCampaignConfigInput,
} from "@jobpilot/contracts/campaign";
import { pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { workspaceChannel } from "@jobpilot/contracts/sse";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { conflict, findOwned, unprocessable } from "@/common/errors";
import { publish } from "@/common/sse";
import {
  type Campaign,
  type CampaignStatus,
  type Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { campaignsQuery } from "./campaign.schema";
import {
  deriveCampaignSummary,
  emptySummary,
  jobSummary,
  summarizeCampaigns,
} from "./campaign.summary";
import { ensureCampaignOwned, publishCampaignStatus } from "./campaign.utils";

const STATUS_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  in_progress: ["paused", "completed", "failed"],
  paused: ["in_progress", "completed", "failed"],
  completed: [],
  failed: [],
};

function toRow(campaign: Campaign & { summary: CampaignSummary }) {
  return { ...campaign, config: campaignConfigSchema.parse(campaign.config) };
}

@singleton()
export class CampaignService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, query: z.infer<typeof campaignsQuery>) {
    const where: Prisma.CampaignWhereInput = {
      userId,
      status: query.status?.length ? { in: query.status } : undefined,
      source: query.source,
      jobs: query.jobStatus ? { some: { status: query.jobStatus } } : undefined,
    };
    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({ where, orderBy: { startedAt: "desc" }, ...pageSlice(query) }),
      this.prisma.campaign.count({ where }),
    ]);
    const rows = await summarizeCampaigns(this.prisma, campaigns);
    return paginate(rows.map(toRow), query, total);
  }

  async create(userId: string, body: CreateCampaignInput) {
    const data: Prisma.CampaignUncheckedCreateInput = {
      userId,
      query: body.query,
      source: body.source,
      config: body.config ?? {},
      createdBy: body.createdBy,
      pilotSearchId: body.pilotSearchId ?? null,
    };
    if (body.urls) {
      return this.createWithQueuedJobs(data, body.urls);
    }

    const campaign = await this.prisma.campaign.create({ data });
    // A just-created campaign provably has no jobs or messages; skip the aggregate round trip.
    return toRow({ ...campaign, summary: emptySummary(campaign.source) });
  }

  /** Seeds pasted links as `queued` jobs with the campaign, so a half-written batch can't strand them. */
  private async createWithQueuedJobs(data: Prisma.CampaignUncheckedCreateInput, urls: string[]) {
    const unique = [...new Set(urls)];
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({ data });
      await tx.job.createMany({
        data: unique.map((url) => ({
          campaignId: created.campaignId,
          key: crypto.randomUUID(),
          // Nothing is known about a pasted link until a worker opens it; the host stands in.
          title: new URL(url).hostname,
          company: "",
          url,
          status: "queued" as const,
        })),
      });
      return created;
    });
    return toRow({
      ...campaign,
      summary: jobSummary([{ status: "queued", count: unique.length }]),
    });
  }

  async get(userId: string, id: string) {
    return this.withSummary(await this.findCampaign(userId, id));
  }

  async updateConfig(userId: string, id: string, body: UpdateCampaignConfigInput) {
    const existing = await this.findCampaign(userId, id);
    if (!campaignConfigSupportsSource(existing.source, body.config)) {
      throw unprocessable(
        "config.resumeId is required for search, auto-apply, and networking campaigns.",
      );
    }
    // Guarded in the write: comparing against `existing` leaves a window for the pilot's strategy
    // review and a user edit to clobber each other.
    const updated = await this.prisma.campaign.updateMany({
      where: {
        campaignId: id,
        userId,
        ...(body.expectedUpdatedAt && { updatedAt: new Date(body.expectedUpdatedAt) }),
      },
      data: { config: body.config },
    });
    if (updated.count === 0) {
      throw conflict("Campaign changed since it was fetched; re-fetch before updating config.");
    }
    return this.withSummary(
      await this.prisma.campaign.findUniqueOrThrow({ where: { campaignId: id } }),
    );
  }

  async commandStatus(userId: string, id: string, body: CampaignStatusCommandInput) {
    const existing = await this.findCampaign(userId, id);
    if (existing.status === body.status) {
      return this.withSummary(existing);
    }
    if (!STATUS_TRANSITIONS[existing.status].includes(body.status)) {
      throw conflict(`Campaign cannot transition from ${existing.status} to ${body.status}.`);
    }
    const finished = body.status === "completed" || body.status === "failed";
    const updated = await this.prisma.campaign.updateMany({
      where: { campaignId: id, userId, status: existing.status },
      data: {
        status: body.status,
        statusActor: body.actor,
        statusReason: body.reason ?? null,
        completedAt: finished ? new Date() : null,
      },
    });
    if (updated.count === 0) {
      throw conflict("Campaign status changed concurrently.");
    }
    publishCampaignStatus(userId, existing, body.status);
    return this.withSummary(
      await this.prisma.campaign.findUniqueOrThrow({ where: { campaignId: id } }),
    );
  }

  async remove(userId: string, id: string) {
    await ensureCampaignOwned(this.prisma, userId, id);
    await this.prisma.$transaction(async (tx) => {
      const messages = await tx.networkingMessage.findMany({
        where: { campaignId: id, userId },
        select: { contactId: true },
      });
      await tx.application.deleteMany({ where: { campaignId: id, userId } });
      await tx.networkingMessage.deleteMany({ where: { campaignId: id, userId } });
      await tx.contact.deleteMany({
        where: {
          id: { in: messages.map((message) => message.contactId) },
          userId,
          messages: { none: {} },
          relatedAppId: null,
        },
      });
      await tx.campaign.delete({ where: { campaignId: id } });
    });
    publish(workspaceChannel, { userId }, { type: "campaign.deleted", campaignId: id });
    return { deleted: true, campaignId: id };
  }

  findCampaign(userId: string, campaignId: string) {
    return findOwned(
      (where) => this.prisma.campaign.findFirst({ where }),
      { campaignId, userId },
      "Campaign",
    );
  }

  private async withSummary(campaign: Campaign) {
    const summary = await deriveCampaignSummary(this.prisma, campaign.campaignId, campaign.source);
    return toRow({ ...campaign, summary });
  }
}
