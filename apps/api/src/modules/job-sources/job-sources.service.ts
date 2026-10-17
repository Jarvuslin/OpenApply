import { campaignConfigSchema } from "@openapply/contracts/campaign";
import {
  type discoverInputSchema,
  discoveryConnectionSchema,
  type discoveryProviderSchema,
} from "@openapply/contracts/job-sources";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import { conflict, findOwned, unprocessable } from "@/common/errors";
import { logger } from "@/common/logger";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";
import { publishCampaignStatus } from "@/modules/campaign/campaign.utils";
import { CompanyResolver } from "@/modules/job-listing/companies";
import { canonicalizeUrl } from "@/modules/job-listing/dedupe";
import { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import { postingIdentity } from "@/modules/job-listing/posting-identity";
import { listedExperience } from "@/modules/mvp/experience";
import { apify } from "./apify";
import { type AtsProvider, fetchAts } from "./ats";
import { lockDiscovery, saveCandidate } from "./candidate-intake";
import { fetchSourceJson, fetchSourceText } from "./http";
import { type PublicFeedId, publicFeed } from "./public-feeds";
import { EmployerResolver } from "./resolver";
import { serpapi, serpapiPage } from "./serpapi";
import { CLASSIFIER_VERSION, droppedJobId, splitByTech } from "./tech-filter";
import type { SourceJob } from "./types";

type Provider = z.infer<typeof discoveryProviderSchema>;
@singleton()
export class JobSourcesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly publisher: JobListingPublisher,
    private readonly resolver: EmployerResolver,
    private readonly companies: CompanyResolver,
  ) {}
  async connections(userId: string) {
    const rows = await this.prisma.jobSourceConnection.findMany({ where: { userId } });
    return rows.map((row) => ({
      provider: row.provider,
      ...discoveryConnectionSchema
        .omit({ apiKey: true })
        .parse({ ...(row.config as object), enabled: row.enabled }),
      configured: true,
    }));
  }
  async configure(
    userId: string,
    provider: Provider,
    input: z.infer<typeof discoveryConnectionSchema>,
  ) {
    const existing = await this.prisma.jobSourceConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!existing && !input.apiKey)
      throw unprocessable("Add your own API key before enabling this connector.");
    const { apiKey, enabled, ...config } = input;
    const encryptedKey = apiKey
      ? await this.crypto.encryptFor(userId, SECRET_CONTEXTS.credentialApiKey, apiKey)
      : existing?.encryptedKey;
    if (!encryptedKey) throw unprocessable("Connector API key is missing.");
    await this.prisma.jobSourceConnection.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, enabled, encryptedKey, config },
      update: { enabled, encryptedKey, config },
    });
    return { provider, enabled, configured: true };
  }
  async publicBoard(
    provider: AtsProvider,
    slug: string,
    list?: { userId: string; campaignId: string },
    company = slug,
    maxJobs = 500,
  ) {
    if (list) await this.checkList(list.userId, list.campaignId);
    let requests = 0;
    const board = await fetchAts(
      (url, init) => {
        requests++;
        return fetchSourceJson(url, init);
      },
      provider,
      slug,
      company,
      {
        describedUrls: (urls) => this.describedUrls(urls),
        techOnly: env.JOB_TECH_FILTER_ENABLED,
      },
      (url) => {
        requests++;
        return fetchSourceText(url);
      },
    );
    return this.store(
      board.jobs,
      provider,
      `${provider}/${slug}`,
      requests,
      list,
      !board.complete,
      maxJobs,
      `${provider}/${slug}`,
    );
  }
  /** The job URLs whose listing already has a description, so their detail pages are skipped. */
  private async describedUrls(urls: string[]): Promise<Set<string>> {
    const byCanonical = new Map(urls.map((url) => [canonicalizeUrl(url), url]));
    const described = new Set<string>();
    const keys = [...byCanonical.keys()];
    for (let start = 0; start < keys.length; start += 1000) {
      const rows = await this.prisma.jobListingSource.findMany({
        where: {
          url: { in: keys.slice(start, start + 1000) },
          listing: { descriptionExcerpt: { not: null } },
        },
        select: { url: true },
      });
      for (const row of rows) described.add(byCanonical.get(row.url) ?? row.url);
    }
    return described;
  }
  async publicFeed(source: PublicFeedId) {
    let requests = 0;
    const jobs = await publicFeed(
      (url, init) => {
        requests++;
        return fetchSourceJson(url, init);
      },
      source,
      (url) => {
        requests++;
        return fetchSourceText(url);
      },
    );
    // Simplify's internship list alone has about 5,000 active roles; the other feeds stay well under.
    return this.store(
      jobs,
      source,
      `public/${source}`,
      requests,
      undefined,
      false,
      6000,
      `public/${source}`,
    );
  }
  async discover(userId: string, input: z.infer<typeof discoverInputSchema>) {
    if (input.board === "hiringcafe")
      throw unprocessable(
        "Use HiringCafe private search previews; this source cannot be imported into the shared index.",
      );
    if (input.campaignId) await this.checkList(userId, input.campaignId);
    const row = await this.prisma.jobSourceConnection.findUnique({
      where: { userId_provider: { userId, provider: input.provider } },
    });
    if (!row?.enabled)
      throw conflict("Enable this discovery connector with your own API key first.");
    const key = await this.crypto.decryptFor(
      userId,
      SECRET_CONTEXTS.credentialApiKey,
      row.encryptedKey,
    );
    const config = discoveryConnectionSchema.parse({
      ...(row.config as object),
      enabled: row.enabled,
    });
    let requests = 0;
    const fetch = (url: string, init?: RequestInit) => {
      requests++;
      return fetchSourceJson(url, init);
    };
    const jobs =
      input.provider === "apify"
        ? await apify(fetch, key, config, input)
        : await serpapi(fetch, key, input);
    return this.store(
      jobs,
      input.board ?? "google_jobs",
      `${input.provider}: ${input.query} (${input.location})`,
      requests,
      input.campaignId ? { userId, campaignId: input.campaignId } : undefined,
      jobs.length >= input.limit,
    );
  }
  async discoverPage(
    userId: string,
    input: z.infer<typeof discoverInputSchema>,
    cursor: string | null,
  ) {
    if (input.board === "hiringcafe")
      throw unprocessable(
        "Use HiringCafe private search previews; this source cannot be imported into the shared index.",
      );
    const row = await this.prisma.jobSourceConnection.findUnique({
      where: { userId_provider: { userId, provider: input.provider } },
    });
    if (!row?.enabled)
      throw conflict(
        "Add and enable your own provider API key in Settings → Connections before searching this source.",
      );
    const key = await this.crypto.decryptFor(
      userId,
      SECRET_CONTEXTS.credentialApiKey,
      row.encryptedKey,
    );
    const config = discoveryConnectionSchema.parse({ ...(row.config as object), enabled: true });
    let requests = 0;
    const fetch = (url: string, init?: RequestInit) => {
      requests++;
      return fetchSourceJson(url, init);
    };
    const page =
      input.provider === "serpapi"
        ? await serpapiPage(fetch, key, input, cursor)
        : { jobs: await apify(fetch, key, config, input), nextCursor: null };
    const result = await this.store(
      page.jobs,
      input.board ?? "google_jobs",
      `${input.provider}: ${input.query} (${input.location})`,
      requests,
    );
    return { ...result, nextCursor: page.nextCursor };
  }
  private async checkList(userId: string, campaignId: string) {
    const campaign = await findOwned(
      (where) => this.prisma.campaign.findFirst({ where }),
      { campaignId, userId },
      "Campaign",
    );
    if (
      campaignConfigSchema.parse(campaign.config).discovery?.phase !== "collecting" ||
      campaign.status !== "in_progress"
    )
      throw conflict("This candidate list is not collecting jobs.");
  }
  private async store(
    jobs: SourceJob[],
    board: string,
    source: string,
    requests: number,
    list?: { userId: string; campaignId: string },
    limited = false,
    maxJobs = 500,
    /** Set for a board or feed refreshed again later, so its dropped job ids are remembered. */
    boardKey?: string,
  ) {
    const fetched = jobs.length;
    let dropped = 0;
    if (env.JOB_TECH_FILTER_ENABLED) {
      const split = await this.techJobs(jobs, boardKey);
      jobs = split.kept;
      dropped = split.dropped;
      logger.info({ source, kept: jobs.length, dropped }, "Tech filter applied");
    }
    const boards = new Map<string, Promise<unknown>>();
    const fetchBoard = (url: string) => {
      let response = boards.get(url);
      if (!response) {
        requests++;
        response = fetchSourceJson(url);
        boards.set(url, response);
      }
      return response;
    };
    let imported = 0,
      resolved = 0;
    const candidates: {
      job: SourceJob;
      resolution: { applyUrl: string | null; confidence: number };
    }[] = [];
    // A board's jobs are its own; a list or feed job belongs to the ATS board its link names.
    const ownBoard = boardKey && !boardKey.startsWith("public/") ? boardKey : null;
    for (const job of jobs.slice(0, maxJobs)) {
      const resolution = await this.resolver.resolve(job, fetchBoard);
      candidates.push({ job, resolution });
      const url = job.identityUrl ?? job.attributionUrl;
      const company = await this.companies.resolve(
        ownBoard ?? postingIdentity(canonicalizeUrl(url))?.boardKey,
        job.company,
      );
      const outcome = await this.publisher.publish({
        ...job,
        url,
        company: company.name,
        companyId: company.id,
        boardKey: ownBoard,
        externalId: job.externalId,
        requisitionId: job.requisitionId,
        board,
        publicFeed: true,
        applyUrl: resolution.applyUrl,
        resolutionConfidence: resolution.confidence,
        attributionUrl: job.attributionUrl,
        postedAt: job.postedAt,
        digest: JSON.stringify({
          remote: /remote/i.test(job.location),
          yearsExperience: listedExperience(job.description),
        }),
      });
      if (outcome !== "skipped") {
        imported++;
        if (resolution.applyUrl) resolved++;
      }
    }
    let saved = 0;
    let truncated = limited || jobs.length > maxJobs;
    if (list) {
      const campaign = await this.prisma.$transaction(
        async (tx) => {
          const { config, campaign } = await lockDiscovery(tx, list.userId, list.campaignId);
          for (const { job, resolution } of candidates) {
            const result = await saveCandidate(
              tx,
              list.campaignId,
              job,
              board,
              resolution,
              config.maxJobs ?? 100,
            );
            if (result.saved) saved++;
            truncated ||= result.truncated;
          }
          await tx.campaign.update({
            where: { campaignId: list.campaignId },
            data: {
              config: {
                ...config,
                discovery: {
                  ...config.discovery!,
                  sources: [
                    ...config.discovery!.sources,
                    {
                      source,
                      fetched: jobs.length,
                      saved,
                      resolved,
                      requests,
                      truncated,
                      checkedAt: new Date().toISOString(),
                    },
                  ],
                },
              },
            },
          });
          return campaign;
        },
        { timeout: 30_000 },
      );
      publishCampaignStatus(list.userId, campaign, campaign.status);
    }
    return { imported, fetched, dropped, resolved, saved, requests, truncated };
  }
  /** Keep tech jobs; remember the board's dropped ids so the next refresh skips them unclassified. */
  private async techJobs(jobs: SourceJob[], boardKey?: string) {
    const rows = boardKey
      ? await this.prisma.droppedJob.findMany({
          where: { boardKey, jobId: { in: jobs.map(droppedJobId) } },
          select: { jobId: true, classifierVersion: true },
        })
      : [];
    const split = splitByTech(jobs, new Map(rows.map((row) => [row.jobId, row.classifierVersion])));
    if (boardKey) {
      if (split.clear.length)
        await this.prisma.droppedJob.deleteMany({
          where: { boardKey, jobId: { in: split.clear } },
        });
      for (const jobId of split.drop)
        await this.prisma.droppedJob.upsert({
          where: { boardKey_jobId: { boardKey, jobId } },
          create: { boardKey, jobId, classifierVersion: CLASSIFIER_VERSION },
          update: { classifierVersion: CLASSIFIER_VERSION, droppedAt: new Date() },
        });
    }
    return split;
  }
}
