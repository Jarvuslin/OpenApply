import { phenom, phenomSite } from "./phenom";
import { expect, it } from "bun:test";

it("reads a site slug as host, country, locale, and tenant code", () => {
  expect(phenomSite("jobs.bell.ca/ca/en_CA/BECACA")).toEqual({
    origin: "https://jobs.bell.ca",
    path: "ca/en",
    country: "ca",
    locale: "en_CA",
    refNum: "BECACA",
  });
  expect(phenomSite("jobs.bell.ca")).toBeNull();
  expect(phenomSite("../x/ca/en_CA/BECACA")).toBeNull();
});

it("pages the site's search widget and keeps every listed city", async () => {
  const bodies: { from: number; refNum: string; lang: string }[] = [];
  const job = (n: number) => ({
    jobId: String(400000 + n),
    reqId: `R-${400000 + n}`,
    title: `Software Developer Intern &amp; Co-op ${n}`,
    location: "Montreal, Quebec",
    multi_location: n === 0 ? ["Toronto, Ontario", "Montreal, Quebec"] : [],
    description: "<p>Build things.</p>",
    postedDate: "2026-09-23T00:00:00.000+0000",
  });
  const { jobs, complete } = await phenom(
    async (url, init) => {
      expect(url).toBe("https://jobs.bell.ca/widgets");
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const count = body.from === 0 ? 500 : 4;
      return {
        refineSearch: {
          totalHits: 503,
          // The second page repeats the first page's last job, as unordered results do.
          data: {
            jobs: Array.from({ length: count }, (_, i) => job(body.from + i - (body.from ? 1 : 0))),
          },
        },
      };
    },
    "jobs.bell.ca/ca/en_CA/BECACA",
    "Bell",
  );
  expect(bodies.map((b) => b.from)).toEqual([0, 500]);
  expect(bodies[0]).toMatchObject({ refNum: "BECACA", lang: "en_CA", ddoKey: "refineSearch" });
  expect(jobs).toHaveLength(503);
  expect(jobs[0]).toEqual({
    title: "Software Developer Intern & Co-op 0",
    company: "Bell",
    location: "Toronto, Ontario; Montreal, Quebec",
    url: "https://jobs.bell.ca/ca/en/job/400000",
    attributionUrl: "https://jobs.bell.ca/ca/en/job/400000",
    externalId: "400000",
    requisitionId: "R-400000",
    description: "Build things.",
    postedAt: new Date("2026-09-23T00:00:00.000Z"),
  });
  expect(jobs[1]?.location).toBe("Montreal, Quebec");
  expect(complete).toBe(true);
});
