import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import type { FetchText } from "./public-feeds-wwr";
import { plainText, type SourceJob } from "./types";

const BASE = "https://www.google.com/about/careers/applications/";
const SEARCH = `${BASE}jobs/results/`;
const PAGE_LIMIT = 20;
const DETAIL_LIMIT = 60;

function detailUrl(href: string): URL | null {
  const url = URL.parse(plainText(href), BASE);
  if (url?.hostname !== "www.google.com" || !allowedApplyUrl(url.href)) return null;
  url.search = "";
  url.hash = "";
  return url;
}

async function searchLinks(html: string): Promise<string[]> {
  const urls = new Set<string>();
  let title = "";
  let main = "";
  await new HTMLRewriter()
    .on("title", {
      text: (chunk) => {
        title += chunk.text;
      },
    })
    .on("main", {
      text: (chunk) => {
        main += chunk.text;
      },
    })
    .on("main a[href]", {
      element(element) {
        const url = detailUrl(element.getAttribute("href") ?? "");
        if (url && urls.size < PAGE_LIMIT) urls.add(url.href);
      },
    })
    .transform(new Response(html))
    .text();
  if (
    !/Google Careers/.test(title) ||
    !main ||
    (!urls.size && !/0 jobs matched|No jobs found|No matching jobs/i.test(plainText(html)))
  ) {
    throw new Error("Google Careers returned an unrecognized search page.");
  }
  return [...urls];
}

async function detailJob(html: string, url: string): Promise<SourceJob | null> {
  const id = /\/results\/(\d+)-/.exec(url)![1]!;
  const scope = `main [data-id="${id}"]`;
  let pageTitle = "";
  let title = "";
  let company = "";
  let main = "";
  let description = "";
  let qualifications = "";
  let responsibilities = "";
  let early = false;
  let hasApply = false;
  let logo: string | null = null;
  const locations: string[] = [];
  await new HTMLRewriter()
    .on("title", {
      text: (chunk) => {
        pageTitle += chunk.text;
      },
    })
    .on("main", {
      text: (chunk) => {
        main += chunk.text;
      },
    })
    .on(`${scope} h2.p1N2lc`, {
      text: (chunk) => {
        title += chunk.text;
      },
    })
    .on(`${scope} .RP7SMd > span`, {
      text: (chunk) => {
        company += chunk.text;
      },
    })
    .on(`${scope} .r0wTof`, {
      element() {
        locations.push("");
      },
      text(chunk) {
        locations[locations.length - 1] += chunk.text;
      },
    })
    .on(`${scope} .aG5W3`, {
      text: (chunk) => {
        description += chunk.text;
      },
    })
    .on(`${scope} .aG5W3 p`, {
      element() {
        description += "\n";
      },
    })
    .on(`${scope} .KwJkGe`, {
      text: (chunk) => {
        qualifications += chunk.text;
      },
    })
    .on(`${scope} .KwJkGe h3, ${scope} .KwJkGe li, ${scope} .KwJkGe p`, {
      element() {
        qualifications += "\n";
      },
    })
    .on(`${scope} .BDNOWe`, {
      text: (chunk) => {
        responsibilities += chunk.text;
      },
    })
    .on(`${scope} .BDNOWe h3, ${scope} .BDNOWe li`, {
      element() {
        responsibilities += "\n";
      },
    })
    .on(`${scope} [aria-label]`, {
      element(element) {
        if (element.getAttribute("aria-label") === "Early, Learn more about experience filters.")
          early = true;
      },
    })
    .on(`${scope} a[aria-label="Apply"]`, {
      element(element) {
        const apply = URL.parse(plainText(element.getAttribute("href") ?? ""), BASE);
        hasApply =
          apply?.origin === "https://www.google.com" &&
          apply.pathname === "/about/careers/applications/apply" &&
          !!apply.searchParams.get("jobId");
      },
    })
    .on('link[rel="shortcut icon"]', {
      element(element) {
        if (element.getAttribute("href") === "https://www.google.com/favicon.ico")
          logo = "https://www.google.com/favicon.ico";
      },
    })
    .transform(new Response(html))
    .text();
  // Expired Google postings return HTTP 200 with search results instead of a detail page.
  if (/\bJob not found\b/i.test(main)) return null;
  title = plainText(title);
  company = plainText(company);
  description = plainText(description);
  const location = [
    ...new Set(locations.map((value) => plainText(value).replace(/^;\s*/, "")).filter(Boolean)),
  ].join("; ");
  if (
    !title ||
    !company ||
    !location ||
    !description ||
    !hasApply ||
    plainText(pageTitle) !== `${title} — Google Careers`
  ) {
    throw new Error("Google Careers returned an unrecognized job detail page.");
  }
  return {
    title,
    company,
    location,
    description: [description, plainText(qualifications), plainText(responsibilities)]
      .filter(Boolean)
      .join("\n\n"),
    url,
    attributionUrl: url,
    postedAt: null,
    level: early ? "entry" : undefined,
    companyLogoUrl: company === "Google" ? logo : null,
  };
}

export async function googleCareers(fetch: FetchText): Promise<SourceJob[]> {
  const candidates = new Map<string, string>();
  // Four first pages only: CA/US Early first, then newest CA/US software searches; no published dates.
  for (const early of [true, false]) {
    for (const location of ["Canada", "United States"]) {
      const url = new URL(SEARCH);
      url.searchParams.set("location", location);
      url.searchParams.set("q", "software engineer");
      url.searchParams.set("sort_by", "date");
      if (early) url.searchParams.set("target_level", "EARLY");
      for (const link of await searchLinks(await fetch(url.href))) {
        const id = /\/results\/(\d+)-/.exec(link)![1]!;
        if (!candidates.has(id) && candidates.size < DETAIL_LIMIT) candidates.set(id, link);
      }
    }
  }
  const urls = [...candidates.values()];
  const jobs: Array<SourceJob | null> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (next < urls.length) {
        const index = next++;
        jobs[index] = await detailJob(await fetch(urls[index]!), urls[index]!);
      }
    }),
  );
  return jobs.filter((job): job is SourceJob => job !== null);
}
