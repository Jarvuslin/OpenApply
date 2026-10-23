import { jibe } from "./jibe";
import { expect, it } from "bun:test";

const job = (n: number) => ({
  data: {
    slug: String(84000 + n),
    req_id: String(84000 + n),
    title: `Staff Engineer &amp; Lead ${n}`,
    description: "<p>Build chips.</p>",
    responsibilities: "<p>Own the test plan.</p>",
    qualifications: null,
    full_location: "Gurgaon, India; Bangalore, India",
    location_name: n === 0 ? "Remote, India" : "India-Gurgaon UCP",
    country_code: "IN",
    additional_locations: [{ country_code: "IN" }, { country_code: "US" }],
    posted_date: "2026-10-21T00:44:00+0000",
  },
});

it("pages the site's job search until the reported total, with every country", async () => {
  const requested: string[] = [];
  const { jobs, reported, complete } = await jibe(
    async (url) => {
      requested.push(url);
      const index = Number(new URL(url).searchParams.get("page"));
      const rows = index === 1 ? Array.from({ length: 100 }, (_, n) => job(n)) : [job(100)];
      return { totalCount: 101, jobs: rows };
    },
    "careers.amd.com",
    "AMD",
  );
  expect(requested).toEqual([
    "https://careers.amd.com/api/jobs?page=1&limit=100",
    "https://careers.amd.com/api/jobs?page=2&limit=100",
  ]);
  expect({ reported, complete, count: jobs.length }).toEqual({
    reported: 101,
    complete: true,
    count: 101,
  });
  expect(jobs[0]).toEqual({
    title: "Staff Engineer & Lead 0",
    company: "AMD",
    location: "Gurgaon, India; Bangalore, India",
    countries: ["IN", "US"],
    url: "https://careers.amd.com/jobs/84000",
    attributionUrl: "https://careers.amd.com/jobs/84000",
    externalId: "84000",
    requisitionId: "84000",
    description: "Build chips.\n\nOwn the test plan.",
    postedAt: new Date("2026-10-21T00:44:00Z"),
    workMode: "remote",
  });
  expect(jobs[1]?.workMode).toBeNull();
});

it("stops on an empty page when the site reports no total", async () => {
  let calls = 0;
  const { jobs, complete } = await jibe(async () => {
    calls++;
    return { jobs: calls === 1 ? [job(0)] : [] };
  }, "careers.medpace.com");
  expect({ calls, count: jobs.length, complete }).toEqual({ calls: 2, count: 1, complete: true });
});

it("refuses a slug that isn't a host", async () => {
  await expect(jibe(async () => ({}), "careers.amd.com/../x")).rejects.toThrow(
    "Invalid Jibe career site.",
  );
});
