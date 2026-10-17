import {
  boardOf,
  simplifyBoards,
  simplifyInternships,
  simplifyNewGrad,
} from "./public-feeds-simplify";
import { expect, it } from "bun:test";

const direct = "https://jobs.ashbyhq.com/acme/123/application?embed=true&utm_source=Simplify";
const NEW_GRAD =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";
const INTERNSHIPS =
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
function row(overrides: Record<string, unknown> = {}) {
  return {
    company_name: "Acme &amp; Co",
    title: "Software Engineer",
    locations: ["Toronto, ON", "Remote in USA"],
    url: direct,
    active: true,
    is_visible: true,
    date_posted: 1791422426,
    date_updated: 1791422625,
    company_url: "https://simplify.jobs/c/Acme",
    ...overrides,
  };
}

it("uses direct employer identity, separate attribution and the date Simplify listed the role", async () => {
  const jobs = await simplifyNewGrad(async (url) => {
    expect(url).toBe(NEW_GRAD);
    return [row()];
  });
  expect(jobs).toEqual([
    {
      company: "Acme & Co",
      title: "Software Engineer",
      location: "Toronto, ON; Remote in USA",
      url: direct,
      identityUrl: "https://jobs.ashbyhq.com/acme/123",
      attributionUrl: "https://github.com/SimplifyJobs/New-Grad-Positions",
      description: "",
      postedAt: new Date(1791422426 * 1000),
      level: "entry",
    },
  ]);
});

it("keeps every active visible role, not only the ones the README table shows", async () => {
  const urls = ["closed", "hidden", "raw-only", "shown"].map((id) => `https://acme.com/jobs/${id}`);
  const jobs = await simplifyNewGrad(async () => [
    row({ url: urls[0], active: false }),
    row({ url: urls[1], is_visible: false }),
    row({ url: urls[2] }),
    row({ url: urls[3], title: "New Grad Engineer" }),
    row({ url: "https://acme.com/jobs/missing-visibility", is_visible: undefined }),
  ]);
  expect(jobs.map((job) => job.url).sort()).toEqual([urls[2], urls[3]]);
});

it("does not lower explicit seniority or infer location eligibility from repository scope", async () => {
  const jobs = await simplifyNewGrad(async () => [
    row({ title: "Senior Graduate Software Engineer", locations: [] }),
  ]);
  expect(jobs[0]).toMatchObject({ level: "senior", location: "" });
  expect(jobs[0]?.countries).toBeUndefined();
  expect(jobs[0]?.workMode).toBeUndefined();
  expect(jobs[0]?.companyLogoUrl).toBeUndefined();
});

it("drops unsafe links and aggregator links without requesting employer pages", async () => {
  const unsafe = [
    "javascript:alert(1)",
    "http://acme.com/jobs/1",
    "https://secret@acme.com/jobs/1",
    "https://127.0.0.1/jobs/1",
    "https://acme.local/jobs/1",
    "https://acme.com:8443/jobs/1",
    "https://linkedin.com/jobs/view/123",
    "https://simplify.jobs/p/123",
    "https://github.com/acme/job",
  ];
  expect(await simplifyNewGrad(async () => unsafe.map((url) => row({ url })))).toEqual([]);
});

it("dedupes ATS application variants, preserves job IDs and prioritizes newest additions", async () => {
  const urls = [
    direct,
    "https://jobs.ashbyhq.com/acme/123?ref=Simplify",
    "https://jobs.lever.co/acme/456/apply?utm_source=Simplify",
    "https://careers.acme.com/openings?gh_jid=789&utm_source=Simplify",
  ];
  const jobs = await simplifyNewGrad(async () =>
    urls.map((url, index) => row({ url, date_posted: index + 1 })),
  );
  expect(jobs.map((job) => job.identityUrl)).toEqual([
    "https://careers.acme.com/openings?gh_jid=789",
    "https://jobs.lever.co/acme/456",
    "https://jobs.ashbyhq.com/acme/123",
  ]);
});

it("accepts an empty list but rejects malformed payloads and outages", async () => {
  expect(await simplifyNewGrad(async () => [])).toEqual([]);
  await expect(simplifyNewGrad(async () => ({}))).rejects.toThrow();
  await expect(
    simplifyNewGrad(async () => {
      throw new Error("HTTP 503");
    }),
  ).rejects.toThrow("HTTP 503");
});

it("recognizes the employer boards the ATS adapters can read", () => {
  expect(boardOf("https://job-boards.greenhouse.io/acme/jobs/1")).toEqual({
    provider: "greenhouse",
    slug: "acme",
  });
  expect(boardOf("https://boards.greenhouse.io/embed/job_app?for=acme&token=1")).toEqual({
    provider: "greenhouse",
    slug: "acme",
  });
  expect(boardOf("https://jobs.ashbyhq.com/acme/123/application")).toEqual({
    provider: "ashby",
    slug: "acme",
  });
  expect(boardOf("https://jobs.lever.co/acme/456/apply")).toEqual({
    provider: "lever",
    slug: "acme",
  });
  expect(boardOf("https://apply.workable.com/acme/j/ABC/")).toEqual({
    provider: "workable",
    slug: "acme",
  });
  expect(boardOf("https://jobs.smartrecruiters.com/Acme/7444/engineer")).toEqual({
    provider: "smartrecruiters",
    slug: "Acme",
  });
  // EU boards, bare careers pages and odd slugs are left to other sources.
  expect(boardOf("https://job-boards.eu.greenhouse.io/acme/jobs/1")).toBeNull();
  expect(boardOf("https://careers.acme.com/openings?gh_jid=789")).toBeNull();
  expect(boardOf("https://boards.greenhouse.io/acme")).toBeNull();
  expect(boardOf("https://jobs.lever.co/acme.inc/1")).toBeNull();
});

it("collects each employer board once from both lists, named by its newest role", async () => {
  const requested: string[] = [];
  const boards = await simplifyBoards(async (url) => {
    requested.push(url);
    if (url === NEW_GRAD)
      return [
        row({ url: "https://jobs.lever.co/acme/1", company_name: "Acme Old", date_posted: 1 }),
        row({ url: "https://jobs.lever.co/ACME/2", company_name: "Acme", date_posted: 5 }),
        row({ url: "https://jobs.ashbyhq.com/closed/1", active: false }),
        row({ url: "https://careers.example.com/jobs/1" }),
      ];
    return [
      row({ url: "https://job-boards.greenhouse.io/intern-co/jobs/9", company_name: "Intern Co" }),
    ];
  });
  expect(requested).toEqual([NEW_GRAD, INTERNSHIPS]);
  expect(boards).toEqual([
    { provider: "lever", slug: "ACME", company: "Acme" },
    { provider: "greenhouse", slug: "intern-co", company: "Intern Co" },
  ]);
});

it("reads the internship list and treats an unlabelled title as an internship", async () => {
  const jobs = await simplifyInternships(async (url) => {
    expect(url).toBe(INTERNSHIPS);
    return [
      row({ title: "Software Engineer, Summer 2027" }),
      row({ title: "Junior Developer", url: "https://acme.com/jobs/2" }),
    ];
  });
  expect(jobs.map((job) => [job.level, job.attributionUrl])).toEqual([
    ["intern", "https://github.com/SimplifyJobs/Summer2027-Internships"],
    ["entry", "https://github.com/SimplifyJobs/Summer2027-Internships"],
  ]);
});

it("reads a Workday board from a job link, with or without a locale", () => {
  expect(
    boardOf("https://manulife.wd3.myworkdayjobs.com/en-US/MFCJH_adminJobs/job/Waterloo/Co-op_JR1"),
  ).toEqual({ provider: "workday", slug: "manulife.wd3.MFCJH_adminJobs" });
  expect(boardOf("https://expedia.wd108.myworkdayjobs.com/private/job/Seattle/Eng_R1")).toEqual({
    provider: "workday",
    slug: "expedia.wd108.private",
  });
  expect(boardOf("https://acme.wd5.myworkdayjobs.com/")).toBeNull();
});
