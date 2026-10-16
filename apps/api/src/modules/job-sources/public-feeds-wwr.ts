import { plainText, postedAt, type SourceJob } from "./types";

export type FetchText = (url: string) => Promise<string>;

function field(item: string, name: string): string {
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
    const header = plainText(field(item, "title"));
    const separator = header.indexOf(":");
    if (separator < 1) continue;
    const title = header.slice(separator + 1).trim();
    const company = header.slice(0, separator).trim();
    const href = plainText(field(item, "link") || field(item, "guid"));
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
    const expires = postedAt(field(item, "expires_at"));
    if (expires && expires.getTime() < Date.now()) continue;
    seen.add(url.href);
    jobs.push({
      title,
      company,
      companyLogoUrl:
        plainText(/<media:content\b[^>]*\burl=["']([^"']+)["']/i.exec(item)?.[1] ?? "") || null,
      location: plainText(field(item, "region")) || "Remote — location not specified",
      url: url.href,
      attributionUrl: url.href,
      description: plainText(field(item, "description")),
      postedAt: postedAt(field(item, "pubDate")),
      type: plainText(field(item, "type")) || null,
      workMode: "remote",
    });
  }
  return jobs;
}
