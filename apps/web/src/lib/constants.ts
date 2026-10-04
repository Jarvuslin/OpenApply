export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Canonical production origin - the single source for metadata, sitemap, robots, and JSON-LD. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4100";

/** GitHub repository, surfaced as the org's `sameAs` and in the footer. */
export const GITHUB_URL = "https://github.com/Jarvuslin/OpenApply";

export const BUG_REPORT_URL = `${GITHUB_URL}/issues/new?template=bug_report.yml`;
export const FEATURE_REQUEST_URL = `${GITHUB_URL}/issues/new?template=feature_request.yml`;
