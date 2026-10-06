import { singleton } from "tsyringe";
import { PrismaClient } from "@/generated/prisma/client";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { ATS, type AtsProvider, fetchAts } from "./ats";
import { fetchSourceJson } from "./http";
import type { FetchJson, SourceJob } from "./types";

const THRESHOLD = 0.88;
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const tokens = (value: string) => new Set(normalize(value).split(" ").filter(Boolean));
function similarity(a: string, b: string): number {
  const left = tokens(a),
    right = tokens(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter((t) => right.has(t)).length / new Set([...left, ...right]).size;
}

export function matchEmployerJob(job: SourceJob, candidates: SourceJob[]) {
  const ranked = candidates
    .map((candidate) => {
      const title = similarity(job.title, candidate.title);
      const location = similarity(job.location, candidate.location);
      const confidence = title * 0.8 + location * 0.2;
      return { candidate, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  const ambiguous =
    ranked[1] &&
    best &&
    best.confidence - ranked[1].confidence < 0.05 &&
    best.candidate.url !== ranked[1].candidate.url;
  return {
    applyUrl:
      best && best.confidence >= THRESHOLD && !ambiguous
        ? allowedApplyUrl(best.candidate.url)
        : null,
    confidence: best?.confidence ?? 0,
  };
}

@singleton()
export class EmployerResolver {
  constructor(private readonly prisma: PrismaClient) {}
  async resolve(job: SourceJob, fetch: FetchJson = fetchSourceJson) {
    const direct = allowedApplyUrl(job.url);
    if (direct) return { applyUrl: direct, confidence: 1 };
    const companyKey = normalize(job.company);
    const cached = await this.prisma.companyAtsBoard.findUnique({ where: { companyKey } });
    const slugs = [
      ...new Set([companyKey.replace(/ /g, ""), companyKey.replace(/ /g, "-")]),
    ].filter((s) => s.length > 0 && s.length <= 80);
    const probes: { provider: AtsProvider; slug: string }[] = [];
    if (cached && cached.checkedAt.getTime() > Date.now() - 7 * 86400_000 && cached.provider in ATS)
      probes.push({ provider: cached.provider as AtsProvider, slug: cached.slug });
    for (const slug of slugs)
      for (const provider of Object.keys(ATS) as AtsProvider[])
        if (!probes.some((p) => p.slug === slug && p.provider === provider))
          probes.push({ provider, slug });
    let confidence = 0;
    for (const probe of probes) {
      let candidates: SourceJob[];
      try {
        candidates = await fetchAts(fetch, probe.provider, probe.slug, job.company);
      } catch {
        continue;
      }
      if (candidates.length === 0) continue;
      const match = matchEmployerJob(job, candidates);
      confidence = Math.max(confidence, match.confidence);
      if (!match.applyUrl) continue;
      await this.prisma.companyAtsBoard.upsert({
        where: { companyKey },
        create: { companyKey, ...probe },
        update: { ...probe, checkedAt: new Date() },
      });
      return match;
    }
    return { applyUrl: null, confidence };
  }
}
