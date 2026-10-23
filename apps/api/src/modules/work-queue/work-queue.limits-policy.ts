import type { QueueLimits } from "@openapply/contracts/work-queue-limits";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";

/** A job saved from a bare link has no company name; the employer is still in its URL. */
function companyFromUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".myworkdayjobs.com")) return host.split(".")[0];
  if (["greenhouse.io", "lever.co", "ashbyhq.com"].some((domain) => host.endsWith(`.${domain}`)))
    return url.pathname.split("/").find(Boolean) ?? "";
  return host.replace(/^(www|careers|jobs)\./, "").split(".")[0];
}

export function workScope(job: { url: string; company: string }) {
  const url = URL.parse(job.url);
  const companyKey =
    normalizeCompanyName(job.company) || (url ? normalizeCompanyName(companyFromUrl(url)) : "");
  if (
    !url ||
    !companyKey ||
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const known = ["greenhouse.io", "lever.co", "ashbyhq.com"];
  const domainKey = known.find((domain) => host === domain || host.endsWith(`.${domain}`)) ?? host;
  return { canonicalUrl: canonicalizeJobUrl(job.url), companyKey, domainKey };
}

export type ReservationFact = {
  identity: string;
  companyKey: string | null;
  at: Date;
  unresolved: boolean;
  held: boolean;
};

export function countReservations(
  facts: ReservationFact[],
  policy: QueueLimits,
  companyKey: string,
  now: Date,
) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const period = new Date(now.getTime() - policy.companyWindowDays * 86_400_000);
  return {
    daily: facts.filter((fact) => fact.held || fact.unresolved || fact.at >= day).length,
    company: facts.filter(
      (fact) =>
        (!fact.companyKey || fact.companyKey === companyKey) &&
        (fact.held || fact.unresolved || fact.at >= period),
    ).length,
  };
}

export function reservationLimit(
  facts: ReservationFact[],
  policy: QueueLimits,
  companyKey: string,
  now: Date,
) {
  const count = countReservations(facts, policy, companyKey, now);
  if (count.daily >= policy.dailyApplicationCap) return "daily_cap" as const;
  if (count.company >= policy.companyApplicationCap) return "company_cap" as const;
  return null;
}
