import { blockedSiteFor } from "./blocked-sites";
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
