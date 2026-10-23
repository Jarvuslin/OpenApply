import type { CampaignConfig } from "@openapply/contracts/campaign";

type SourceCoverage = NonNullable<CampaignConfig["discovery"]>["sources"][number];

export function summarizeDiscoverySources(sources: readonly SourceCoverage[]): SourceCoverage[] {
  const groups = new Map<string, SourceCoverage>();
  for (const source of sources) {
    const existing = groups.get(source.source);
    if (!existing) {
      groups.set(source.source, { ...source });
      continue;
    }
    existing.fetched += source.fetched;
    existing.saved += source.saved;
    existing.resolved += source.resolved;
    existing.requests += source.requests;
    existing.truncated ||= source.truncated;
    if (new Date(source.checkedAt).getTime() > new Date(existing.checkedAt).getTime())
      existing.checkedAt = source.checkedAt;
  }
  return [...groups.values()];
}
