/** A posting's board ("provider/slug", lowercase) and the board's own id for it. */
export interface PostingIdentity {
  boardKey: string;
  externalId: string;
}

const LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

/**
 * The board and job id an ATS link names, so a list or aggregator job can be matched to the same
 * job read straight from the employer's board. Null for links that name no ATS posting.
 */
export function postingIdentity(rawUrl: string): PostingIdentity | null {
  const url = URL.parse(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const identity = (provider: string, slug: string | undefined, id: string | undefined) =>
    slug && id ? { boardKey: `${provider}/${slug}`.toLowerCase(), externalId: id } : null;

  if (/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/.test(host)) {
    if (parts[0] === "embed")
      return identity(
        "greenhouse",
        url.searchParams.get("for") ?? undefined,
        url.searchParams.get("token") ?? undefined,
      );
    return parts[1] === "jobs" ? identity("greenhouse", parts[0], parts[2]) : null;
  }
  if (/^jobs(?:\.eu)?\.lever\.co$/.test(host)) return identity("lever", parts[0], parts[1]);
  if (host === "jobs.ashbyhq.com") return identity("ashby", parts[0], parts[1]);
  if (host === "apply.workable.com")
    return parts[1] === "j" ? identity("workable", parts[0], parts[2]) : null;
  if (host === "jobs.smartrecruiters.com") return identity("smartrecruiters", parts[0], parts[1]);
  const workday = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/.exec(host);
  if (workday) {
    const path = LOCALE.test(parts[0] ?? "") ? parts.slice(1) : parts;
    const [site, marker] = path;
    if (marker !== "job" || path.length < 3) return null;
    return identity("workday", `${workday[1]}.${workday[2]}.${site}`, path.at(-1));
  }
  return null;
}

/** A Greenhouse posting on the employer's own site carries its id as `gh_jid`. */
export function greenhouseJobId(rawUrl: string): string | null {
  return URL.parse(rawUrl)?.searchParams.get("gh_jid") ?? null;
}
