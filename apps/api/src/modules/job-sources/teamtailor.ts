import { unprocessable } from "@/common/errors";
import { type FetchText, xmlField } from "./public-feeds-wwr";
import { type BoardResult, boardResult, plainText, postedAt, type SourceJob } from "./types";

// Teamtailor boards live at {company}.teamtailor.com, or {company}.{region}.teamtailor.com for a
// board hosted in another region, so a slug is "minagroup" or "minagroup.na".
const BOARD_SLUG = /^[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z]{2})?$/;

/** Reads a board's public RSS feed, which lists every published job with its places. */
export async function teamtailor(
  fetchText: FetchText,
  slug: string,
  company = slug,
): Promise<BoardResult> {
  if (!BOARD_SLUG.test(slug)) throw unprocessable("Invalid Teamtailor board.");
  const origin = `https://${slug}.teamtailor.com`;
  const xml = await fetchText(`${origin}/jobs.rss`);
  if (!/<rss\b/i.test(xml)) throw unprocessable("Teamtailor returned an invalid RSS feed.");
  const board = plainText(xmlField(xml.split(/<item\b/i)[0] ?? "", "title"));
  const jobs: SourceJob[] = [];
  for (const [, item = ""] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    const link = plainText(xmlField(item, "link"));
    // A job links to its own board; anything else isn't this board's posting.
    const id = link.startsWith(`${origin}/jobs/`) ? /\/jobs\/(\d+)/.exec(link)?.[1] : undefined;
    if (!id) continue;
    const places = [...item.matchAll(/<tt:location>([\s\S]*?)<\/tt:location>/gi)].map(
      ([, place = ""]) => ({
        city: plainText(xmlField(place, "tt:city")),
        country: plainText(xmlField(place, "tt:country")),
      }),
    );
    const remote = plainText(xmlField(item, "remoteStatus"));
    jobs.push({
      title: plainText(xmlField(item, "title")),
      company: company === slug && board ? board : company,
      location: places
        .map((place) => [place.city, place.country].filter(Boolean).join(", "))
        .filter(Boolean)
        .join("; "),
      countries: [...new Set(places.map((place) => place.country).filter(Boolean))],
      url: link,
      attributionUrl: link,
      externalId: id,
      description: plainText(xmlField(item, "description")),
      postedAt: postedAt(xmlField(item, "pubDate")),
      workMode: workMode(remote),
    });
  }
  return boardResult(jobs, null, jobs.length, false);
}

/** `remoteStatus` is "none", "hybrid", "fully" or "temporary". */
function workMode(status: string): SourceJob["workMode"] {
  if (status === "fully") return "remote";
  if (status === "hybrid") return "hybrid";
  if (status === "none") return "onsite";
  return null;
}
