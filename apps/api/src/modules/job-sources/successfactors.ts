import { unprocessable } from "@/common/errors";
import type { FetchText } from "./public-feeds-wwr";
import { monthDayYear, plainText, type SourceJob } from "./types";

// A SuccessFactors career site lives on the employer's own domain, so a slug is its hostname.
const SITE_SLUG = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const PAGE = 25;
const MAX_PAGES = 100;

function spanText(row: string, name: string) {
  const match = new RegExp(`<span class="${name}">([\\s\\S]*?)</span>`).exec(row);
  return match ? plainText(match[1] ?? "") : "";
}

export async function successfactors(
  fetch: FetchText,
  slug: string,
  company = slug,
): Promise<SourceJob[]> {
  if (!SITE_SLUG.test(slug)) throw unprocessable("Invalid SuccessFactors site.");
  const origin = `https://${slug}`;
  const jobs: SourceJob[] = [];
  let total = 0;
  for (let index = 0; index < MAX_PAGES; index++) {
    // The search page is the crawlable listing; robots.txt disallows the /services/ JSON API.
    const html = await fetch(
      `${origin}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${index * PAGE}`,
    );
    if (index === 0) total = Number(/of <b>(\d+)<\/b>/.exec(html)?.[1] ?? 0);
    const rows = html.split('<tr class="data-row">').slice(1);
    for (const row of rows) {
      // A sub-brand lists under its own prefix, such as Scotiabank's "/Tangerine/job/…".
      const link = /<a href="(\/(?:[\w-]+\/)?job\/[^"]+)" class="jobTitle-link">([^<]+)<\/a>/.exec(
        row,
      );
      if (!link?.[1] || !link[2]) continue;
      const url = `${origin}${link[1].replaceAll("&amp;", "&")}`;
      jobs.push({
        title: plainText(link[2]),
        company,
        // "Windsor, ON, CA, N8X 3Y8 +2 more…": keep the first place; the others aren't listed here.
        location: spanText(row, "jobLocation")
          .replace(/ \+\d+ more.*$/, "")
          .replace(/, [A-Z]\d[A-Z] ?\d[A-Z]\d$/, ""),
        url,
        attributionUrl: url,
        description: "",
        // The search page's "Oct 15, 2026" is the posting's reference date, not its last edit.
        postedAt: monthDayYear(spanText(row, "jobDate")),
      });
    }
    if (rows.length < PAGE || (index + 1) * PAGE >= total) break;
  }
  return jobs;
}
