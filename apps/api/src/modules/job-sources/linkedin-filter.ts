import type { LinkedinSearch } from "@openapply/contracts/linkedin-discovery";
import { listingCountryCodes } from "@/modules/job-listing/listing-countries";
import { listedExperience } from "@/modules/mvp/experience";
import type { SourceJob } from "./types";

const SENIOR_TITLE =
  /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|chief|executive|vp)\b/i;
const INTERN_TITLE = /\b(?:intern(?:ship)?|co[- ]?op)\b/i;
const ENTRY_TITLE =
  /\b(?:junior|jr\.?|new[ -]?grad(?:uate)?|entry(?:[ -]level)?|early[ -]career|associate)\b|\b(?:engineer|developer|analyst|sde|swe)\s+(?:i|1)\b/i;
const REMOTE = /\b(?:remote|worldwide|anywhere|work from home)\b/i;
const GLOBAL_REMOTE = /\b(?:worldwide|anywhere|global)\b/i;
const COUNTRY_LOCATION =
  /^(?:canada|ca|united states(?: of america)?|us|usa|united kingdom|uk|gb|australia|au|germany|de)$/i;

const phrase = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function linkedinJobUrl(value: string): string {
  const url = new URL(value);
  const id = url.pathname.match(/(\d+)\/?$/)?.[1];
  return `https://www.linkedin.com/jobs/view/${id}`;
}

function matchesLocation(job: SourceJob, search: LinkedinSearch): boolean {
  const remote = job.workMode === "remote" || (job.workMode == null && REMOTE.test(job.location));
  if (search.remoteOnly && !remote) return false;
  const countries = listingCountryCodes(job.countries, job.location);
  const expected = listingCountryCodes(search.countries, search.location);
  const countryMatch = expected.some((country) => countries.includes(country));
  if (expected.length && countries.length && !countryMatch) return false;
  const globalRemote = remote && GLOBAL_REMOTE.test(job.location);
  if (search.countries.length && !countryMatch && !globalRemote) return false;
  if (COUNTRY_LOCATION.test(search.location.trim())) return countryMatch || globalRemote;
  if (REMOTE.test(search.location) && remote)
    return !expected.length || countryMatch || globalRemote;
  const place = phrase(search.location.split(",")[0] ?? search.location);
  if (` ${phrase(job.location)} `.includes(` ${place} `)) return true;
  return search.remoteOnly && remote && (countryMatch || globalRemote);
}

export function linkedinFilterReason(job: SourceJob, search: LinkedinSearch): string | null {
  if (SENIOR_TITLE.test(job.title)) return "seniority";
  const intern = INTERN_TITLE.test(job.title);
  if (intern && !search.experienceLevels.includes("intern")) return "internship";
  if (!intern && !search.experienceLevels.includes("entry")) return "entry";
  const years = listedExperience(job.description);
  if (years !== undefined && years > search.maxYearsExperience) return "experience";
  if (!intern && !ENTRY_TITLE.test(job.title) && years === undefined)
    return "unverified entry level";
  if (!matchesLocation(job, search)) return "location";
  return null;
}
