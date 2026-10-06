export interface SourceJob {
  title: string;
  company: string;
  location: string;
  url: string;
  attributionUrl: string;
  description: string;
  postedAt: Date | null;
}

export type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;

export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function postedAt(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
