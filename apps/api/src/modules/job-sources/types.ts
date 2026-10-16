import type { JOB_LEVELS } from "@openapply/contracts/job-listing";

export interface SourceJob {
  title: string;
  company: string;
  location: string;
  url: string;
  attributionUrl: string;
  /** A stable per-posting URL when attribution points to a curated collection. */
  identityUrl?: string;
  description: string;
  postedAt: Date | null;
  countries?: string[];
  level?: (typeof JOB_LEVELS)[number];
  workMode?: "remote" | "hybrid" | "onsite" | null;
  type?: string | null;
  salary?: string | null;
  companyLogoUrl?: string | null;
  companyLogoPageUrl?: string;
}

export type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;

export function plainText(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  let decoded = value;
  // Greenhouse can HTML-encode the entire markup, including nested ampersands.
  for (let pass = 0; pass < 2; pass++) {
    decoded = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    });
  }
  return decoded
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function postedAt(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Oct 15, 2026" or "Sept 2, 2026" as UTC midnight. */
export function monthDayYear(text: string): Date | null {
  const match = /^([a-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/i.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[1]?.toLowerCase() ?? "") : -1;
  if (!match || month < 0) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}
