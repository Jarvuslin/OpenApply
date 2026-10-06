import {
  type discoverInputSchema,
  discoveryConnectionSchema,
  type discoveryProviderSchema,
} from "@jobpilot/contracts/job-sources";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import { conflict, unprocessable } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import { listedExperience } from "@/modules/mvp/experience";
import { apify } from "./apify";
import { type AtsProvider, fetchAts } from "./ats";
import { fetchSourceJson } from "./http";
import { EmployerResolver } from "./resolver";
import { serpapi } from "./serpapi";
import type { SourceJob } from "./types";

type Provider = z.infer<typeof discoveryProviderSchema>;
@singleton()
export class JobSourcesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly publisher: JobListingPublisher,
    private readonly resolver: EmployerResolver,
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
  async publicBoard(provider: AtsProvider, slug: string) {
    const jobs = await fetchAts(fetchSourceJson, provider, slug);
    return this.store(jobs, provider);
  }
  async discover(userId: string, input: z.infer<typeof discoverInputSchema>) {
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
    const jobs =
      input.provider === "apify"
        ? await apify(fetchSourceJson, key, config, input)
        : await serpapi(fetchSourceJson, key, input);
    return this.store(jobs, input.board ?? "google_jobs");
  }
  private async store(jobs: SourceJob[], board: string) {
    const boards = new Map<string, Promise<unknown>>();
    const fetchBoard = (url: string) => {
      let response = boards.get(url);
      if (!response) {
        response = fetchSourceJson(url);
        boards.set(url, response);
      }
      return response;
    };
    let imported = 0,
      resolved = 0;
    for (const job of jobs.slice(0, 500)) {
      const resolution = await this.resolver.resolve(job, fetchBoard);
      const outcome = await this.publisher.publish({
        ...job,
        url: job.attributionUrl,
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
    return { imported, fetched: jobs.length, resolved };
  }
}
