import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  type LinkedinIngestInput,
  type LinkedinSearch,
  type LinkedinSettingsInput,
  linkedinIngestResultSchema,
  linkedinIngestSchema,
  linkedinSearchSchema,
  linkedinSettingsInputSchema,
} from "@openapply/contracts/linkedin-discovery";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { sha256 } from "@/common/crypto/hash";
import { conflict, notFound, unprocessable } from "@/common/errors";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { canonicalizeUrl } from "@/modules/job-listing/dedupe";
import { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import type { ListingSourceJob } from "@/modules/job-listing/listing-draft";
import { listedExperience } from "@/modules/mvp/experience";
import { fetchSourceJson } from "./http";
import { linkedinFilterReason, linkedinJobUrl } from "./linkedin-filter";
import { EmployerResolver } from "./resolver";
import type { SourceJob } from "./types";

const DAY = 24 * 60 * 60_000;
const LEASE = 60 * 60_000;
const PROCESSING = 15 * 60_000;
const RESOLUTION_BUDGET = 90_000;
const searchesSchema = z.array(linkedinSearchSchema).min(1).max(4);
type IngestResult = z.infer<typeof linkedinIngestResultSchema>;
type Candidate = { job: SourceJob; searches: LinkedinSearch[] };

function savedResult(value: Prisma.JsonValue): IngestResult {
  const stored = value as Prisma.JsonObject;
  return linkedinIngestResultSchema.parse({
    ...stored,
    backoffUntil: stored.backoffUntil ? new Date(String(stored.backoffUntil)) : null,
  });
}

@singleton()
export class LinkedinDiscoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resolver: EmployerResolver,
    private readonly publisher: JobListingPublisher,
  ) {}

  async settings(userId: string) {
    const [row, run, completed] = await Promise.all([
      this.prisma.linkedinDiscoverySettings.findUnique({ where: { userId } }),
      this.prisma.linkedinDiscoveryRun.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.linkedinDiscoveryRun.findFirst({
        where: { userId, status: "completed" },
        orderBy: { completedAt: "desc" },
      }),
    ]);
    return {
      enabled: row?.enabled ?? false,
      searches: row ? z.array(linkedinSearchSchema).max(4).parse(row.searches) : [],
      lastRunAt: row?.lastRunAt ?? null,
      nextRunAt: row?.nextRunAt ?? null,
      backoffUntil: row?.backoffUntil ?? null,
      lastRunStatus: run?.status ?? null,
      lastCompletedAt: completed?.completedAt ?? null,
      lastResult: completed?.result ? savedResult(completed.result) : null,
    };
  }

  async configure(userId: string, input: LinkedinSettingsInput) {
    const data = linkedinSettingsInputSchema.parse(input);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      await tx.linkedinDiscoverySettings.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    });
    return this.settings(userId);
  }

  async claim(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const settings = await tx.linkedinDiscoverySettings.findUnique({ where: { userId } });
      if (!settings?.enabled) throw conflict("LinkedIn discovery is disabled.");
      const now = new Date();
      if (
        (settings.nextRunAt && settings.nextRunAt > now) ||
        (settings.backoffUntil && settings.backoffUntil > now)
      )
        throw conflict("LinkedIn discovery is not due yet. Check nextRunAt and backoffUntil.");
      const searches = searchesSchema.parse(settings.searches);
      const leaseToken = randomBytes(32).toString("hex");
      const run = await tx.linkedinDiscoveryRun.create({
        data: {
          userId,
          searches,
          leaseHash: sha256(leaseToken),
          leaseExpiresAt: new Date(now.getTime() + LEASE),
        },
      });
      await tx.linkedinDiscoverySettings.update({
        where: { userId },
        data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + DAY) },
      });
      return {
        runId: run.id,
        leaseToken,
        searches: searches.map((search, index) => ({ index, ...search })),
        maxResultsPerSearch: 50 as const,
        maxPagesPerSearch: 5 as const,
        maxResults: 200 as const,
      };
    });
  }

  async ingest(userId: string, raw: LinkedinIngestInput): Promise<IngestResult> {
    const input = linkedinIngestSchema.parse(raw);
    const payloadHash = sha256(JSON.stringify(input.searches));
    const started = await this.beginIngest(userId, input, payloadHash);
    if (started.result) return started.result;
    try {
      const result = await this.importJobs(userId, input, started.searches, started.backoffUntil);
      await this.prisma.linkedinDiscoveryRun.update({
        where: { id: input.runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          processingUntil: null,
          result: JSON.parse(JSON.stringify(result)),
        },
      });
      return result;
    } catch (error) {
      await this.prisma.linkedinDiscoveryRun.updateMany({
        where: { id: input.runId, userId, status: "processing", payloadHash },
        data: { status: "claimed", processingUntil: null },
      });
      throw error;
    }
  }

  private async beginIngest(userId: string, input: LinkedinIngestInput, payloadHash: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const run = await tx.linkedinDiscoveryRun.findFirst({ where: { id: input.runId, userId } });
      if (
        !run ||
        !timingSafeEqual(Buffer.from(run.leaseHash), Buffer.from(sha256(input.leaseToken)))
      )
        throw notFound("Discovery run");
      if (run.payloadHash && run.payloadHash !== payloadHash)
        throw conflict("This run already received a different result. Retry the original payload.");
      if (run.status === "completed") {
        return { result: savedResult(run.result!), searches: [], backoffUntil: null };
      }
      const settings = await tx.linkedinDiscoverySettings.findUnique({ where: { userId } });
      if (!settings?.enabled) throw conflict("LinkedIn discovery is disabled.");
      const now = new Date();
      if (run.leaseExpiresAt <= now) throw conflict("This discovery run's lease expired.");
      if (run.status === "processing" && run.processingUntil && run.processingUntil > now)
        throw conflict(
          "This discovery result is already processing. Retry the same payload later.",
        );
      const searches = searchesSchema.parse(run.searches);
      if (
        input.searches.length !== searches.length ||
        input.searches.some((search) => !searches[search.index])
      )
        throw unprocessable("Report each search from the claimed snapshot exactly once.");
      let backoffUntil = settings.backoffUntil;
      if (
        input.searches.some(
          (search) =>
            search.status !== "ok" ||
            (search.httpStatus !== undefined && search.httpStatus !== 200),
        )
      ) {
        backoffUntil = new Date(now.getTime() + DAY);
        await tx.linkedinDiscoverySettings.update({
          where: { userId },
          data: { backoffUntil, nextRunAt: backoffUntil },
        });
      }
      await tx.linkedinDiscoveryRun.update({
        where: { id: run.id },
        data: {
          status: "processing",
          payloadHash,
          processingUntil: new Date(now.getTime() + PROCESSING),
        },
      });
      return { result: null, searches, backoffUntil };
    });
  }

  private async importJobs(
    userId: string,
    input: LinkedinIngestInput,
    searches: LinkedinSearch[],
    backoffUntil: Date | null,
  ): Promise<IngestResult> {
    const deadline = Date.now() + RESOLUTION_BUDGET;
    const candidates = new Map<string, Candidate>();
    for (const search of input.searches) {
      for (const row of search.jobs) {
        const url = linkedinJobUrl(row.url);
        const candidate = candidates.get(url);
        if (candidate) candidate.searches.push(searches[search.index]!);
        else
          candidates.set(url, {
            job: { ...row, url, attributionUrl: url, postedAt: row.datePosted ?? null },
            searches: [searches[search.index]!],
          });
      }
    }
    const responses = new Map<string, Promise<unknown>>();
    const fetch = (url: string, init?: RequestInit) => {
      if (Date.now() >= deadline) throw new Error("Employer resolution budget exhausted.");
      let response = responses.get(url);
      if (!response) {
        response = fetchSourceJson(url, init);
        responses.set(url, response);
      }
      return response;
    };
    const drafts: ListingSourceJob[] = [];
    let filtered = 0;
    const entries = [...candidates.values()];
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(
        entries.slice(offset, offset + 4).map(async ({ job, searches: rules }) => {
          const match =
            Date.now() < deadline
              ? await this.resolver.resolve(job, fetch)
              : { applyUrl: null, confidence: 0, matchedJob: null };
          const employer = match.matchedJob ?? job;
          if (match.matchedJob && rules.every((rule) => linkedinFilterReason(employer, rule))) {
            filtered++;
            return;
          }
          const applyUrl = match.matchedJob ? allowedApplyUrl(match.applyUrl) : null;
          drafts.push({
            ...employer,
            publicFeed: true,
            board: "linkedin-jobspy",
            url: job.url,
            attributionUrl: job.url,
            applyUrl,
            resolutionConfidence: applyUrl ? match.confidence : 0,
            digest: JSON.stringify({ yearsExperience: listedExperience(employer.description) }),
          });
        }),
      );
    }
    const result = {
      runId: input.runId,
      imported: 0,
      resolved: 0,
      filtered,
      unresolved: 0,
      backoffUntil,
      fetched: input.searches.reduce((count, search) => count + search.jobs.length, 0),
      pagesFetched: input.searches.reduce((count, search) => count + search.pagesFetched, 0),
    };
    const seen = new Set<string>();
    for (const draft of drafts) {
      const identity = canonicalizeUrl(draft.applyUrl ?? draft.url);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const settings = await this.prisma.linkedinDiscoverySettings.findUnique({
        where: { userId },
      });
      if (!settings?.enabled) throw conflict("LinkedIn discovery was disabled during ingestion.");
      const outcome = await this.publisher.publishPrivate(draft, userId);
      if (outcome === "skipped") {
        result.filtered++;
        continue;
      }
      result.imported++;
      if (draft.applyUrl) result.resolved++;
      else result.unresolved++;
    }
    return result;
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  }
}
