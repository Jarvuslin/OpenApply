import { plainText, postedAt, type SourceJob } from "./types";

export type FetchText = (url: string) => Promise<string>;

/** The text of an RSS element, with any CDATA wrapper removed. */
export function xmlField(item: string, name: string): string {
  const value =
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, "i").exec(item)?.[1] ?? "";
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

export async function weWorkRemotely(fetch: FetchText): Promise<SourceJob[]> {
  const xml = await fetch("https://weworkremotely.com/remote-jobs.rss");
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml) || !/<\/rss\s*>/i.test(xml)) {
    throw new Error("We Work Remotely returned an invalid RSS feed.");
  }
  const jobs: SourceJob[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    if (jobs.length >= 1000) break;
    const item = match[1]!;
    const header = plainText(xmlField(item, "title"));
    const separator = header.indexOf(":");
    if (separator < 1) continue;
    const title = header.slice(separator + 1).trim();
    const company = header.slice(0, separator).trim();
    const href = plainText(xmlField(item, "link") || xmlField(item, "guid"));
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (
      !title ||
      url.protocol !== "https:" ||
      url.hostname !== "weworkremotely.com" ||
      seen.has(url.href)
    )
      continue;
    const expires = postedAt(xmlField(item, "expires_at"));
    if (expires && expires.getTime() < Date.now()) continue;
    seen.add(url.href);
    jobs.push({
      title,
      company,
      companyLogoUrl:
        plainText(/<media:content\b[^>]*\burl=["']([^"']+)["']/i.exec(item)?.[1] ?? "") || null,
      location: plainText(xmlField(item, "region")) || "Remote — location not specified",
      url: url.href,
      attributionUrl: url.href,
      // Each job's link ends in its own slug, which is how the feed itself tells jobs apart.
      externalId: url.pathname.split("/").filter(Boolean).pop(),
      description: plainText(xmlField(item, "description")),
      postedAt: postedAt(xmlField(item, "pubDate")),
      type: plainText(xmlField(item, "type")) || null,
      workMode: "remote",
    });
  }
  return jobs;
}
