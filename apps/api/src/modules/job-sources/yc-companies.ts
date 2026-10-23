import { z } from "zod/v4";
import type { AtsProvider } from "./ats";
import type { FetchJson } from "./types";

const YC_HIRING = "https://yc-oss.github.io/api/companies/hiring.json";
const company = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  website: z.string().max(500).nullish(),
});
export type YcCompany = z.infer<typeof company>;

/** Most YC startups that post on a public ATS use one of these; SmartRecruiters is rare. */
export const PROBE_PROVIDERS: AtsProvider[] = ["ashby", "greenhouse", "lever", "workable"];

/** Y Combinator companies the open yc-oss directory marks as hiring, one per slug. */
export async function ycHiringCompanies(fetch: FetchJson): Promise<YcCompany[]> {
  const rows = z
    .array(z.unknown())
    .max(20_000)
    .parse(await fetch(YC_HIRING));
  const companies = new Map<string, YcCompany>();
  for (const row of rows) {
    const parsed = company.safeParse(row);
    if (parsed.success && !companies.has(parsed.data.slug))
      companies.set(parsed.data.slug, parsed.data);
  }
  return [...companies.values()];
}

/** Board slugs a company is likely to use: its YC slug, then its name with only letters and digits. */
export function boardSlugs(candidate: YcCompany): string[] {
  const name = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [...new Set([candidate.slug.toLowerCase(), name])].filter((slug) =>
    /^[a-z0-9][a-z0-9-]{1,79}$/.test(slug),
  );
}

function host(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A guessed board belongs to the company when its postings mention the company's own domain or
 * name. Another employer that merely shares the slug rarely does.
 */
export function boardBelongsTo(candidate: YcCompany, postings: string[]): boolean {
  const text = postings.join("\n").toLowerCase();
  const domain = host(candidate.website);
  if (domain && text.includes(domain)) return true;
  const name = candidate.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`).test(text);
}
