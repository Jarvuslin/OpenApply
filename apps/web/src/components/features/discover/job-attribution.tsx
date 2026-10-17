import type { ReactNode } from "react";
import { Link, Stack } from "@mui/material";

interface JobAttributionProps {
  links: { board: string | null; url: string }[];
}

const SOURCE_NAMES: Record<string, string> = {
  remoteok: "Remote OK",
  weworkremotely: "We Work Remotely",
  hackernews: "Hacker News",
  "hackernews-jobs": "Hacker News",
  greenhouse: "Greenhouse",
  icims: "iCIMS",
  ashby: "Ashby",
  lever: "Lever",
  oracle: "Oracle Recruiting",
  phenom: "Phenom",
  smartrecruiters: "SmartRecruiters",
  successfactors: "SuccessFactors",
  taleo: "Taleo",
  workable: "Workable",
  workday: "Workday",
  linkedin: "LinkedIn",
  "linkedin-jobspy": "LinkedIn · logged-out discovery",
  "simplify-new-grad": "Simplify · New Grad",
  "simplify-internships": "Simplify · Internships",
  "canadian-internships": "Canadian Tech Internships",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  google_jobs: "Google Jobs",
  "google-careers": "Google Careers",
};

export function jobSourceName(board: string | null): string {
  return SOURCE_NAMES[board ?? ""] ?? board ?? "original source";
}

export function JobAttribution({ links }: JobAttributionProps): ReactNode {
  // One link per site: a posting often has several URLs on the same board (page, apply form).
  const unique = [
    ...new Map(
      links
        .filter((link) => /^https?:\/\//i.test(link.url))
        .toReversed()
        .map((link) => [jobSourceName(link.board), link]),
    ).values(),
  ].toReversed();
  if (!unique.length) return null;
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
      {unique.map((link) => (
        <Link
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
        >
          Via {jobSourceName(link.board)}
        </Link>
      ))}
    </Stack>
  );
}
