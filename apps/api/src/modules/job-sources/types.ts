import type { JOB_LEVELS } from "@openapply/contracts/job-listing";

export interface SourceJob {
  title: string;
  company: string;
  location: string;
  url: string;
  attributionUrl: string;
  /** A stable per-posting URL when attribution points to a curated collection. */
  identityUrl?: string;
  /** The source's own id for this posting, unique within its board. */
  externalId?: string;
  /** The employer's requisition number, which can tie one opening together across sources. */
  requisitionId?: string;
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

/** One employer board read. `complete` is false when a page limit cut it short or fewer jobs
 *  came back than the board reports. */
export interface BoardResult {
  jobs: SourceJob[];
  reported: number | null;
  complete: boolean;
  /** Fetched only some job families, so a job missing from it may still be on the board. */
  narrowed?: boolean;
}

export interface BoardOptions {
  /** Of these job URLs, the ones whose description is already indexed, so detail pages are skipped. */
  describedUrls?: (urls: string[]) => Promise<Set<string>>;
  /** Most job detail pages one refresh may fetch; the rest wait for a later refresh. */
  detailBudget?: number;
  /** Skip clearly non-tech job families where a board exposes them (Workday). */
  techOnly?: boolean;
}

/** Board read that stopped early: `seen` rows out of `reported`, with `limited` when a page cap hit. */
export function boardResult(
  jobs: SourceJob[],
  reported: number | null,
  seen: number,
  limited: boolean,
): BoardResult {
  return { jobs, reported, complete: !limited && (reported === null || seen >= reported) };
}

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

const REQUISITION = /^[A-Za-z]{0,6}[-_]?\d[\w.-]{1,28}$/;

/** A structured requisition field, or null when it holds a placeholder like "See Opening ID". */
export function requisition(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && REQUISITION.test(trimmed) ? trimmed : undefined;
}

/** A requisition number named in posting text: "Req ID: 432857", "R-0000183912", "JR123456". */
export function requisitionFrom(text: string): string | undefined {
  const labelled =
    /\b(?:req(?:uisition)?\.?\s*(?:id|#|no\.?|number)|job\s*(?:id|#|number)|identifiant de r[ée]quisition)\s*[:#]?\s*([A-Za-z]{0,6}[-_]?\d[\w-]{1,28})/i.exec(
      text,
    )?.[1];
  const coded = /\b((?:JR|REQ|R)-?\d{4,12}(?:-\d{1,3})?)\b/.exec(text)?.[1];
  return requisition(labelled ?? coded);
}
