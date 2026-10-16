import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

// "jobs.bell.ca/ca/en_CA/BECACA": host, site country, locale, and Phenom's tenant code.
const SITE_SLUG =
  /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([a-z]{2})\/([a-z]{2})_([A-Z]{2})\/([A-Z0-9]{4,20})$/;
// Results come in no stable order, so small pages repeat and skip jobs; one page holds most boards.
const PAGE = 500;
const MAX_PAGES = 10;

const page = z.object({
  refineSearch: z.object({
    totalHits: z.number().default(0),
    data: z.object({
      jobs: z.array(
        z.object({
          jobId: z.string().regex(/^[\w-]+$/),
          title: z.string(),
          location: z.string().nullish(),
          multi_location: z.array(z.string()).nullish(),
          description: z.string().nullish(),
          descriptionTeaser: z.string().nullish(),
          postedDate: z.string().nullish(),
        }),
      ),
    }),
  }),
});

export function phenomSite(slug: string) {
  const match = SITE_SLUG.exec(slug);
  if (!match) return null;
  const [, host, country, language, region, refNum] = match as unknown as string[];
  return {
    origin: `https://${host}`,
    path: `${country}/${language}`,
    country: country as string,
    locale: `${language}_${region}`,
    refNum: refNum as string,
  };
}

export async function phenom(fetch: FetchJson, slug: string, company = slug): Promise<SourceJob[]> {
  const site = phenomSite(slug);
  if (!site) throw unprocessable("Invalid Phenom career site.");
  const jobs = new Map<string, SourceJob>();
  let total = 0;
  for (let index = 0; index < MAX_PAGES; index++) {
    // The site's own search widget; robots.txt disallows /px-widgets and /apply, not /widgets.
    const data = page.parse(
      await fetch(`${site.origin}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ddoKey: "refineSearch",
          refNum: site.refNum,
          lang: site.locale,
          country: site.country,
          siteType: "external",
          pageName: "search-results",
          deviceType: "desktop",
          keywords: "",
          global: true,
          jobs: true,
          counts: false,
          from: index * PAGE,
          size: PAGE,
          selected_fields: {},
          all_fields: [],
        }),
      }),
    ).refineSearch;
    if (index === 0) total = data.totalHits;
    for (const job of data.data.jobs) {
      const url = `${site.origin}/${site.path}/job/${job.jobId}`;
      jobs.set(job.jobId, {
        title: plainText(job.title),
        company,
        // Every city is kept so a pilot filtering on any one of them still finds the job.
        location: job.multi_location?.length ? job.multi_location.join("; ") : (job.location ?? ""),
        url,
        attributionUrl: url,
        description: plainText(job.description ?? job.descriptionTeaser ?? ""),
        postedAt: postedAt(job.postedDate),
      });
    }
    if (data.data.jobs.length < PAGE || (index + 1) * PAGE >= total) break;
  }
  return [...jobs.values()];
}
