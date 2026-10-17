import { unprocessable } from "@/common/errors";
import { withDetails } from "./details";
import { jobPostings } from "./json-ld";
import type { FetchText } from "./public-feeds-wwr";
import {
  type BoardOptions,
  type BoardResult,
  boardResult,
  plainText,
  requisition,
  type SourceJob,
} from "./types";

// iCIMS portals live at {portal}.icims.com, so a slug is the portal, for example "careers-peraton".
const PORTAL_SLUG = /^[a-z0-9][a-z0-9-]{2,62}$/;
const MAX_PAGES = 100;
const DAY = 86_400_000;
const CARD = /<li class="iCIMS_JobCardItem">([\s\S]*?)<\/li>/g;

/**
 * Reads a portal's search pages, 20 to 100 jobs each, newest first. About a third of portals
 * show the posting time on the list; some others show it in the job page's JobPosting data, and
 * the rest don't publish it at all.
 */
export async function icims(
  fetchText: FetchText,
  slug: string,
  company = slug,
  options: BoardOptions = {},
): Promise<BoardResult> {
  if (!PORTAL_SLUG.test(slug)) throw unprocessable("Invalid iCIMS portal.");
  const origin = `https://${slug}.icims.com`;
  const jobs: SourceJob[] = [];
  const ids = new Set<string>();
  let pages = 1;
  let limited = false;
  for (let index = 0; index < pages; index++) {
    if (index === MAX_PAGES) {
      limited = true;
      break;
    }
    const html = await fetchText(`${origin}/jobs/search?ss=1&in_iframe=1&pr=${index}`);
    if (index === 0) pages = Number(/Page \d+ of (\d+)/.exec(html)?.[1] ?? 1);
    for (const [, card = ""] of html.matchAll(CARD)) {
      const link = /href="https:\/\/[^/"]+\/jobs\/(\d+)\/([^/"]+)\/job/.exec(card);
      if (!link?.[1] || ids.has(link[1])) continue;
      ids.add(link[1]);
      const url = `${origin}/jobs/${link[1]}/${link[2]}/job`;
      jobs.push({
        title: plainText(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? ""),
        company,
        location: plainText(field(card, "Job Locations?") ?? ""),
        url,
        attributionUrl: url,
        externalId: link[1],
        requisitionId: requisition(
          /Requisition ID<\/dt>\s*<dd[^>]*>\s*<span[^>]*>([^<]*)</.exec(card)?.[1],
        ),
        description: plainText(
          /class="col-xs-12 description">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "",
        ),
        postedAt: listedTime(card),
      });
    }
  }
  // The list's description is a cut-off excerpt, so every job is read from its page in turn.
  await withDetails(jobs, options, async (listed) => {
    const [posting] = jobPostings(await fetchText(`${listed.url}?in_iframe=1`));
    if (!posting) return {};
    return {
      ...(posting.description && { description: posting.description }),
      ...(!listed.postedAt && real(posting.postedAt) && { postedAt: posting.postedAt }),
      ...(!listed.location && posting.location && { location: posting.location }),
      ...(posting.countries.length > 0 && { countries: posting.countries }),
    };
  });
  return boardResult(
    jobs.filter((job) => job.title),
    null,
    jobs.length,
    limited,
  );
}

/**
 * A portal that hides the posting date still fills `datePosted`, with the time of the request
 * moved back exactly two years; a real one is midnight of the day it went live.
 */
function real(date: Date | null): date is Date {
  if (!date) return false;
  const placeholder = new Date();
  placeholder.setUTCFullYear(placeholder.getUTCFullYear() - 2);
  return Math.abs(date.getTime() - placeholder.getTime()) > DAY;
}

/** The value after a card's screen-reader label, such as "Job Locations". */
function field(card: string, label: string): string | undefined {
  return new RegExp(`field-label">${label}</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`).exec(
    card,
  )?.[1];
}

/** "10/17/2026 11:02 AM" in the portal's own time zone, which the page doesn't name; read as UTC. */
function listedTime(card: string): Date | null {
  const match = /title="(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) ([AP])M"/.exec(card);
  if (!match) return null;
  const [month, day, year, hour, minute] = match.slice(1, 6).map(Number) as number[];
  const hours = ((hour ?? 0) % 12) + (match[6] === "P" ? 12 : 0);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hours, minute ?? 0));
}
