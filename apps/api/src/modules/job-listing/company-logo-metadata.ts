import { validatePublicLogoUrl } from "./company-logo-http";

const ATS_HOSTS = new Set([
  "jobs.ashbyhq.com",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
  "apply.workable.com",
]);
const NON_EMPLOYER_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "google.com",
  "ziprecruiter.com",
  "wellfound.com",
  "builtin.com",
  "remoteok.com",
  "weworkremotely.com",
  "ycombinator.com",
  "hiring.cafe",
  "hiringcafe.com",
  "github.com",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "icims.com",
  "ashbyhq.com",
  "greenhouse.io",
  "lever.co",
  "smartrecruiters.com",
  "workable.com",
];

export function companyLogoPage(value: string): string | null {
  const safe = validatePublicLogoUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (ATS_HOSTS.has(url.hostname)) {
    const tenant = url.pathname.split("/").filter(Boolean)[0];
    if (!tenant || (url.hostname === "apply.workable.com" && ["j", "api"].includes(tenant)))
      return null;
    const host =
      url.hostname === "jobs.smartrecruiters.com" ? "careers.smartrecruiters.com" : url.hostname;
    return `https://${host}/${tenant}`;
  }
  if (NON_EMPLOYER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
    return null;
  return url.origin;
}

export function isGenericBoardLogo(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === "news.ycombinator.com" ||
    (url.hostname === "remoteok.com" &&
      /\/(?:assets\/)?(?:logo|favicon|apple-touch-icon)[^/]*$/i.test(url.pathname)) ||
    (url.hostname === "weworkremotely.com" &&
      /\/assets\/(?:wwr|logo|favicon)[^/]*$/i.test(url.pathname))
  );
}

function imageValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const image = value as Record<string, unknown>;
  if (typeof image.url === "string") return image.url;
  return typeof image.contentUrl === "string" ? image.contentUrl : null;
}

function decodeUrl(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
    const hex = key.toLowerCase().startsWith("#x");
    const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function organizationLogos(value: unknown, depth = 0): string[] {
  if (depth > 8 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => organizationLogos(item, depth + 1));
  const item = value as Record<string, unknown>;
  const type = item["@type"];
  const types = Array.isArray(type) ? type : [type];
  const logos: string[] = [];
  if (types.includes("Organization") || types.includes("Corporation")) {
    const logo = imageValue(item.logo);
    if (logo) logos.push(logo);
  }
  if (item.hiringOrganization) {
    const org = item.hiringOrganization as Record<string, unknown>;
    const logo = imageValue(org.logo);
    if (logo) logos.push(logo);
  }
  if (item["@graph"]) logos.push(...organizationLogos(item["@graph"], depth + 1));
  return logos;
}

/** Read employer branding, never a job's generic social-preview photo or an ATS favicon. */
export function logoFromHtml(html: string, pageUrl: string): string | null {
  return logoCandidatesFromHtml(html, pageUrl)[0] ?? null;
}

export function logoCandidatesFromHtml(html: string, pageUrl: string): string[] {
  if (!companyLogoPage(pageUrl)) return [];
  const page = new URL(pageUrl);
  const ats = ATS_HOSTS.has(page.hostname);
  const structured: string[] = [];
  const branded: string[] = [];
  const icons: string[] = [];
  let script = "";
  new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element() {
        script = "";
      },
      text(chunk) {
        script += chunk.text;
        if (!chunk.lastInTextNode) return;
        try {
          structured.push(...organizationLogos(JSON.parse(script)));
        } catch {
          /* Invalid source metadata. */
        }
      },
    })
    .on("img", {
      element(element) {
        if (!ats) return;
        const identity = `${element.getAttribute("alt") ?? ""} ${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`;
        const src = element.getAttribute("src");
        if (src && /(?:company|brand|header|organization)[-_\s]*logo|\blogo\b/i.test(identity))
          branded.push(src);
      },
    })
    .on("a.logo img, .main-header-logo img, #logo img", {
      element(element) {
        if (!ats) return;
        const src = element.getAttribute("src");
        if (src) branded.unshift(src);
      },
    })
    .on("header img", {
      element(element) {
        const identity = `${element.getAttribute("alt") ?? ""} ${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`;
        const src = element.getAttribute("src");
        if (!ats && src && /logo/i.test(identity)) branded.push(src);
      },
    })
    .on("link", {
      element(element) {
        if (ats) return;
        const rel = element.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? [];
        const href = element.getAttribute("href");
        if (!href) return;
        if (rel.includes("apple-touch-icon")) icons.unshift(href);
        else if (rel.includes("icon")) icons.push(href);
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        const src = element.getAttribute("content");
        if (ats && src && /\/org-theme-logo\//.test(src)) branded.unshift(src);
        if (
          page.hostname === "apply.workable.com" &&
          src &&
          /\/uploads\/account\/open_graph_logo\//.test(src)
        )
          branded.unshift(src);
      },
    })
    .transform(html);

  if (page.hostname === "jobs.ashbyhq.com") {
    for (const key of ["logoSquareImageUrl", "logoWordmarkImageUrl"]) {
      const match = html.match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
      if (match?.[1]) {
        try {
          structured.push(JSON.parse(match[1]));
        } catch {
          /* Invalid source metadata. */
        }
      }
    }
  }
  const candidates = new Set<string>();
  for (const candidate of [...structured, ...branded, ...icons]) {
    const url = validatePublicLogoUrl(decodeUrl(candidate), pageUrl);
    if (
      url &&
      !isGenericBoardLogo(url) &&
      !/\/cdn_assets\/.*favicon|\/ashby-logo|\/lever-logo/i.test(url)
    )
      candidates.add(url);
  }
  return [...candidates].slice(0, 8);
}
