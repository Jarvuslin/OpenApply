import { allowedApplyUrl, blockedSiteFor } from "./blocked-sites";
import { describe, expect, it } from "bun:test";

describe("blockedSiteFor", () => {
  it.each([
    "linkedin.com",
    "https://ca.linkedin.com/jobs/1",
    "indeed.ca",
    "ca.indeed.com",
    "glassdoor.co.uk",
    "www.ziprecruiter.com",
    "upwork.com/tenant",
    "joinhandshake.com",
    "wellfound.com",
    "LINKEDIN.COM.",
  ])("blocks %s", (value) => expect(blockedSiteFor(value)).not.toBeNull());
  it.each([
    "notlinkedin.com",
    "linkedin.com.evil.example",
    "https://employer.example/?next=linkedin.com",
    "jobs.lever.co/acme",
    "https://greenhouse.io/jobs/1",
  ])("does not confuse %s with a board", (value) => expect(blockedSiteFor(value)).toBeNull());
});

describe("Google employer apply URLs", () => {
  it("allows exact official numeric Careers detail pages", () => {
    const url =
      "https://www.google.com/about/careers/applications/jobs/results/143221669039612614-data-center-technician-ii";
    expect(allowedApplyUrl(url)).toBe(url);
    expect(allowedApplyUrl(`${url}?location=Canada`)).toBe(`${url}?location=Canada`);
  });
  it.each([
    "https://www.google.com/search?q=jobs",
    "https://www.google.com/url?q=https://employer.example",
    "https://www.google.com/about/careers/applications/jobs/results/",
    "https://www.google.com/about/careers/applications/jobs/results/not-a-job",
    "https://www.google.com/about/careers/applications/jobs/results/123-role/redirect",
    "https://google.com/about/careers/applications/jobs/results/123-role",
    "https://careers.google.com/about/careers/applications/jobs/results/123-role",
    "https://www.google.ca/about/careers/applications/jobs/results/123-role",
    "https://www.google.com.au/about/careers/applications/jobs/results/123-role",
    "https://www.google.com./url?q=https://employer.example",
    "https://www.google.com:8443/about/careers/applications/jobs/results/123-role",
    "http://www.google.com/about/careers/applications/jobs/results/123-role",
    "https://secret@www.google.com/about/careers/applications/jobs/results/123-role",
    "https://serpapi.com/search?engine=google_jobs",
    "https://api.apify.com/v2/acts",
  ])("keeps discovery and non-career URLs blocked: %s", (url) => {
    expect(allowedApplyUrl(url)).toBeNull();
  });
});
