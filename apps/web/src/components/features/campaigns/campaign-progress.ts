import type { CampaignSource, CampaignSummary } from "@openapply/contracts/campaign";

export const CAMPAIGN_SOURCE_LABELS: Record<CampaignSource, string> = {
  search: "Search",
  auto_apply: "Auto-apply",
  apply: "Apply to links",
  networking: "Networking",
};

export function campaignProgress(
  source: CampaignSource,
  summary: CampaignSummary,
): { value: number | undefined; label: string } {
  if (summary.totalFound === 0) return { value: undefined, label: "Finding jobs" };

  const searching = source === "search";
  const completed = searching ? summary.scored : summary.applied;
  const total = searching ? summary.totalFound : summary.qualified || summary.totalFound;
  return {
    value: Math.min(100, (completed / total) * 100),
    label: `${completed}/${total} ${searching ? "scored" : "applied"}`,
  };
}

/** "Profile job list: entry level AI Engineer Intern, entry level SWE …" → "AI Engineer Intern + 1 more". */
export function campaignShortName(query: string): string {
  const roles = query
    .replace(/^profile job list:\s*/i, "")
    .split(",")
    .map((role) => role.replace(/^\s*entry level\s+/i, "").trim())
    .filter(Boolean);
  if (roles.length <= 1) return roles[0] ?? query;
  return `${roles[0]} + ${roles.length - 1} more`;
}

export function campaignStage(source: CampaignSource, summary: CampaignSummary): string {
  if (summary.totalFound === 0) return "Searching";
  if (summary.scored < summary.totalFound) return "Scoring";
  return source === "search" ? "Ready to review" : "Applying";
}
