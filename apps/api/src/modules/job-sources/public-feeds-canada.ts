import { jobLevelFromTitle } from "@openapply/contracts/job-listing";
import { applyLink, identity } from "./public-feeds-simplify";
import type { FetchText } from "./public-feeds-wwr";
import { monthDayYear, plainText, type SourceJob } from "./types";

const REPOSITORY = "negarprh/Canadian-Tech-Internships-2027";
const README = `https://raw.githubusercontent.com/${REPOSITORY}/main/README.md`;

/** Open roles in the community-kept Canadian tech internship table; closed rows carry no link. */
export async function canadianInternships(fetch: FetchText): Promise<SourceJob[]> {
  const jobs = new Map<string, SourceJob>();
  let company = "";
  for (const line of (await fetch(README)).split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const [, name, role, place, apply, posted] = cells;
    if (!name || !role || name === "Company" || name.startsWith("-")) continue;
    // "↳" repeats the company from the row above.
    if (name !== "↳") company = plainText(name);
    const link = /\]\((https:\/\/[^)\s]+)\)\s*$/.exec(apply ?? "")?.[1];
    const url = link ? applyLink(link) : null;
    const title = plainText(role);
    if (!url || !title || !company) continue;
    const level = jobLevelFromTitle(title);
    const key = identity(url);
    if (jobs.has(key)) continue;
    jobs.set(key, {
      title,
      company,
      location: (place ?? "").split(" / ").map(plainText).filter(Boolean).join("; "),
      url,
      identityUrl: key,
      attributionUrl: `https://github.com/${REPOSITORY}`,
      description: "",
      postedAt: monthDayYear(posted ?? ""),
      level: level === "unknown" ? "intern" : level,
    });
  }
  return [...jobs.values()];
}
