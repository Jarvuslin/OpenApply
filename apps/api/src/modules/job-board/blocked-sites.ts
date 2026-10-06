import { unprocessable } from "@/common/errors";

const SITES = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  ziprecruiter: "ZipRecruiter",
  upwork: "Upwork",
  joinhandshake: "Handshake",
  wellfound: "Wellfound",
} as const;

export function blockedSiteFor(urlOrDomain: string): string | null {
  let host: string;
  try {
    host = new URL(urlOrDomain.includes("://") ? urlOrDomain : `https://${urlOrDomain}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    return null;
  }
  for (const [domain, name] of Object.entries(SITES)) {
    if (
      host === domain ||
      new RegExp(`(^|\\.)${domain}\\.(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})$`).test(host)
    )
      return name;
  }
  return null;
}

export function assertAutomationAllowed(value: string): void {
  const site = blockedSiteFor(value);
  if (site)
    throw unprocessable(
      `${site} is discovery-only. Use the employer's careers page or ATS to apply.`,
    );
}

export function allowedApplyUrl(value: string | null | undefined): string | null {
  if (!value || blockedSiteFor(value)) return null;
  const url = URL.parse(value);
  if (url?.protocol !== "https:" || url.username || url.password || !url.hostname.includes("."))
    return null;
  if (/(^|\.)(google|serpapi|apify)\.(com|[a-z]{2}|co\.[a-z]{2})$/.test(url.hostname)) return null;
  return url.toString();
}
