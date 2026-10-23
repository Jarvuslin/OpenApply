import { buildListingDraft } from "@/modules/job-listing/listing-draft";
import { publicFeed } from "./public-feeds";
import { googleCareers } from "./public-feeds-google";
import { describe, expect, it } from "bun:test";

const base = "https://www.google.com/about/careers/applications/jobs/results/";
const link = (id: number) => `${base}${id}-software-engineer`;
const search = (ids: number[]) => `<title>Search Jobs — Google Careers</title><main>
  ${ids.map((id) => `<a href="jobs/results/${id}-software-engineer?location=Canada&amp;q=software">Learn more</a>`).join("")}
  ${ids.length ? "" : "No jobs found"}</main>`;

function detail(id: number, badge = "Early") {
  return `<title>Software Engineer &amp; Developer — Google Careers</title>
    <link rel="shortcut icon" href="https://www.google.com/favicon.ico">
    <div data-id="99"><h2 class="p1N2lc">Wrong search result</h2>
      <button aria-label="Early, Learn more about experience filters.">Early</button></div>
    <main><div data-id="${id}">
      <h2 class="p1N2lc">Software Engineer &amp; Developer</h2>
      <span class="RP7SMd"><i>corporate_fare</i><span>Google</span></span>
      <span class="r0wTof">Waterloo, ON, Canada</span><span class="r0wTof">; New York, NY, USA</span>
      <span class="r0wTof">Waterloo, ON, Canada</span>
      <button aria-label="${badge}, Learn more about experience filters.">${badge}</button>
      <a aria-label="Apply" href="./apply?jobId=public-job-id&amp;loc=CA">Apply</a>
      <div class="aG5W3"><h3>About the job</h3><p>Build systems &amp; tools.</p><p>Collaborate on software.</p></div>
      <div class="KwJkGe"><h3>Minimum qualifications:</h3><ul><li>2 years of experience with software development.</li></ul>
        <h3>Preferred qualifications:</h3><ul><li>Experience with distributed systems.</li></ul></div>
      <div class="BDNOWe"><h3>Responsibilities</h3><ul><li>Design and test reliable services.</li></ul></div>
    </div></main>`;
}

describe("Google Careers public feed", () => {
  it("verifies details, deduplicates search hits and preserves actual metadata without invented dates", async () => {
    const requests: string[] = [];
    const jobs = await publicFeed(
      async () => {
        throw new Error("No JSON endpoint");
      },
      "google-careers",
      async (url) => {
        requests.push(url);
        if (new URL(url).pathname.endsWith("/results/")) {
          return search([123, 123]).replace(
            "</main>",
            '<a href="https://www.google.com/url?q=evil">Redirect</a></main>',
          );
        }
        expect(url).toBe(link(123));
        return detail(123);
      },
    );
    expect(requests).toHaveLength(5);
    expect(
      requests.slice(0, 4).map((value) => {
        const query = new URL(value).searchParams;
        expect(query.get("sort_by")).toBe("date");
        expect(query.get("q")).toBe("software engineer");
        return [query.get("location"), query.get("target_level")];
      }),
    ).toEqual([
      ["Canada", "EARLY"],
      ["United States", "EARLY"],
      ["Canada", null],
      ["United States", null],
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Software Engineer & Developer",
      company: "Google",
      location: "Waterloo, ON, Canada; New York, NY, USA",
      url: link(123),
      attributionUrl: link(123),
      postedAt: null,
      level: "entry",
      companyLogoUrl: "https://www.google.com/favicon.ico",
    });
    expect(jobs[0]?.description).toContain("Build systems & tools.");
    expect(jobs[0]?.description).toContain(
      "Minimum qualifications: 2 years of experience with software development.",
    );
    expect(jobs[0]?.description).toContain(
      "Preferred qualifications: Experience with distributed systems.",
    );
    expect(jobs[0]?.description).toContain("Responsibilities Design and test reliable services.");
    expect(buildListingDraft({ ...jobs[0]!, publicFeed: true })).toMatchObject({
      level: "entry",
      countries: ["CA", "US"],
      applyUrl: link(123),
      postedAt: null,
    });
  });

  it("caps four searches at 20 candidates each and 60 detail checks, prioritizing Early CA/US", async () => {
    let searches = 0;
    let active = 0;
    let maxActive = 0;
    const details: number[] = [];
    const jobs = await googleCareers(async (url) => {
      if (new URL(url).pathname.endsWith("/results/")) {
        const start = searches++ * 100;
        return search(Array.from({ length: 25 }, (_, index) => start + index + 1));
      }
      const id = Number(/results\/(\d+)/.exec(url)![1]);
      details.push(id);
      maxActive = Math.max(maxActive, ++active);
      await Promise.resolve();
      active--;
      return detail(id);
    });
    expect(searches).toBe(4);
    expect(details).toHaveLength(60);
    expect(jobs).toHaveLength(60);
    expect(details.filter((id) => id <= 20)).toHaveLength(20);
    expect(details.filter((id) => id >= 101 && id <= 120)).toHaveLength(20);
    expect(details.some((id) => id > 220)).toBe(false);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("does not infer Early from search filters or from another result outside the detail", async () => {
    const jobs = await googleCareers(async (url) =>
      new URL(url).pathname.endsWith("/results/") ? search([123]) : detail(123, "Mid"),
    );
    expect(jobs[0]?.level).toBeUndefined();
  });

  it("skips HTTP-200 expired details and accepts an explicitly empty search", async () => {
    const jobs = await googleCareers(async (url) =>
      new URL(url).pathname.endsWith("/results/")
        ? search([123])
        : "<title>Jobs search — Google Careers</title><main><h2>Job not found</h2></main>",
    );
    expect(jobs).toEqual([]);
    expect(await googleCareers(async () => search([]))).toEqual([]);
  });

  it.each([
    "<html><title>Sign in</title></html>",
    "<title>Google Careers</title><main>Temporarily unavailable</main>",
  ])("rejects unexpected search HTML instead of reporting an empty healthy feed", async (html) => {
    await expect(googleCareers(async () => html)).rejects.toThrow("unrecognized search page");
  });

  it.each([
    detail(999),
    detail(123).replace('aria-label="Apply"', 'aria-label="Closed"'),
    detail(123).replace("./apply?jobId=public-job-id", "https://evil.example/apply?jobId=x"),
    detail(123).replace("<title>Software Engineer &amp; Developer", "<title>Unrelated role"),
  ])("rejects mismatched, closed or malformed details", async (html) => {
    await expect(
      googleCareers(async (url) =>
        new URL(url).pathname.endsWith("/results/") ? search([123]) : html,
      ),
    ).rejects.toThrow("unrecognized job detail page");
  });

  it("propagates a failed detail request so the refresh is not reported as successful", async () => {
    await expect(
      googleCareers(async (url) => {
        if (new URL(url).pathname.endsWith("/results/")) return search([123]);
        throw new Error("HTTP 429");
      }),
    ).rejects.toThrow("HTTP 429");
  });
});
