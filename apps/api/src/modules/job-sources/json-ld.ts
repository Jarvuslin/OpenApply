import { jsonLd } from "@/modules/job-listing/company-logo-metadata";
import { plainText, postedAt } from "./types";

/** The parts of a schema.org JobPosting a source job is built from. */
export interface JobPostingData {
  title: string;
  description: string;
  postedAt: Date | null;
  location: string;
  countries: string[];
  identifier: string | undefined;
  company: string | undefined;
}

type Item = Record<string, unknown>;

/** Every JobPosting a page declares, found in arrays and `@graph` lists too. */
export function jobPostings(html: string): JobPostingData[] {
  const found: Item[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = value as Item;
    const type = item["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))
      found.push(item);
    visit(item["@graph"], depth + 1);
  };
  for (const block of jsonLd(html)) visit(block, 0);
  return found.map(posting);
}

function posting(item: Item): JobPostingData {
  const places = [item.jobLocation].flat().filter((place): place is Item => !!place);
  const addresses = places.map((place) => (place.address ?? {}) as Item);
  const text = (value: unknown) =>
    typeof value === "string" && value !== "UNAVAILABLE" ? plainText(value) : "";
  const identifier = item.identifier as Item | string | undefined;
  return {
    title: text(item.title),
    description: text(item.description),
    postedAt: postedAt(typeof item.datePosted === "string" ? item.datePosted : null),
    location: addresses
      .map((address) =>
        [address.addressLocality, address.addressRegion, country(address.addressCountry)]
          .map(text)
          .filter(Boolean)
          .join(", "),
      )
      .filter(Boolean)
      .join("; "),
    countries: [
      ...new Set(addresses.map((address) => country(address.addressCountry)).filter(Boolean)),
    ],
    identifier: text(typeof identifier === "object" ? identifier?.value : identifier) || undefined,
    company: text((item.hiringOrganization as Item | undefined)?.name) || undefined,
  };
}

function country(value: unknown): string {
  if (typeof value === "string") return value === "UNAVAILABLE" ? "" : value;
  const name = (value as Item | undefined)?.name;
  return typeof name === "string" ? name : "";
}
