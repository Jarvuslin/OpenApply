import { z } from "zod/v4";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const api = "https://hacker-news.firebaseio.com/v0";
const itemSchema = z.object({
  id: z.number().int().positive(),
  type: z.string().optional(),
  by: z.string().optional(),
  parent: z.number().optional(),
  time: z.number().optional(),
  text: z.string().default(""),
  title: z.string().default(""),
  url: z.string().optional(),
  kids: z.array(z.number().int().positive()).default([]),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
type Item = z.infer<typeof itemSchema>;
const role =
  /\b(engineer|developer|designer|scientist|manager|analyst|architect|devops|SRE|sales|recruiter|researcher|founder|intern|lead|director)\b/i;

async function getItems(fetch: FetchJson, ids: number[]): Promise<Item[]> {
  const items: Item[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(ids.length, 4) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const parsed = itemSchema.safeParse(await fetch(`${api}/item/${id}.json`));
        if (parsed.success && !parsed.data.dead && !parsed.data.deleted) items.push(parsed.data);
      }
    }),
  );
  return items;
}

function hiringPost(item: Item): SourceJob | null {
  const firstLine = plainText(item.text.split(/<p\b[^>]*>|<br\s*\/?\s*>|\n/i)[0] ?? "");
  const segments = firstLine.split(/\s*\|\s*|\s+[—–]\s+/).filter(Boolean);
  if (segments.length < 2) return null;
  const company = segments[0]!.replace(/\s*\((?:YC\b|Remote\b)[^)]*\)/gi, "").trim();
  if (!company || company.length > 120 || /^https?:/i.test(company)) return null;
  const title = segments
    .slice(1)
    .find((segment) => role.test(segment) && !/^https?:/i.test(segment));
  const location = segments
    .slice(1)
    .filter(
      (segment) =>
        !role.test(segment) &&
        !/^https?:/i.test(segment) &&
        !/[$€£]|\b(full[ -]?time|part[ -]?time|equity|salary|contract)\b/i.test(segment),
    )
    .join("; ");
  let workMode: SourceJob["workMode"] = null;
  if (/\bhybrid\b/i.test(firstLine)) workMode = "hybrid";
  else if (/\bremote\b/i.test(firstLine) && !/\b(?:no|not)\s+remote\b/i.test(firstLine))
    workMode = "remote";
  else if (/\bonsite\b|\bon-site\b/i.test(firstLine)) workMode = "onsite";
  const url = `https://news.ycombinator.com/item?id=${item.id}`;
  return {
    title: title?.slice(0, 240) ?? `Hiring at ${company}`,
    company,
    location: location.slice(0, 500) || "Location not specified — see posting",
    url,
    attributionUrl: url,
    description: plainText(item.text),
    postedAt: postedAt(item.time == null ? null : item.time * 1000),
    workMode,
  };
}

export async function hackerNewsHiring(fetch: FetchJson): Promise<SourceJob[]> {
  const user = z
    .object({ submitted: z.array(z.number().int().positive()) })
    .parse(await fetch(`${api}/user/whoishiring.json`));
  const stories = await getItems(fetch, user.submitted.slice(0, 6));
  const thread = stories
    .filter((item) => item.by === "whoishiring" && /^Ask HN: Who is hiring\?/i.test(item.title))
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0];
  if (!thread) throw new Error("Hacker News did not return a current hiring thread.");
  // Ranked comment order changes; IDs retain chronological order for a bounded recent window.
  const comments = await getItems(
    fetch,
    [...new Set(thread.kids)].sort((a, b) => b - a).slice(0, 500),
  );
  return comments
    .filter((item) => item.type === "comment" && item.parent === thread.id)
    .map(hiringPost)
    .filter((job): job is SourceJob => job !== null)
    .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
}

export async function hackerNewsJobs(fetch: FetchJson): Promise<SourceJob[]> {
  const ids = z.array(z.number().int().positive()).parse(await fetch(`${api}/jobstories.json`));
  const jobs = await getItems(fetch, [...new Set(ids)].slice(0, 200));
  return jobs
    .filter((item) => item.type === "job" && item.title)
    .map((item) => {
      const title = plainText(item.title);
      const company =
        title.split(/\s*\(YC\b|\s+(?:is hiring|is looking|hiring|seeks)\b/i)[0]?.trim() ?? "";
      const attributionUrl = `https://news.ycombinator.com/item?id=${item.id}`;
      return {
        title,
        company: company && company.length < title.length ? company : "Employer on Hacker News",
        location: "Location not specified — see posting",
        url: attributionUrl,
        attributionUrl,
        description: plainText(item.text) || title,
        postedAt: postedAt(item.time == null ? null : item.time * 1000),
      };
    });
}
