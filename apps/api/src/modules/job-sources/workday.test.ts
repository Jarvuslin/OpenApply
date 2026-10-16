import { techFamilies, workday, workdayBoard, workdayPostedAt } from "./workday";
import { expect, it } from "bun:test";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86400_000;

it("reads a board slug as tenant, instance, and site", () => {
  expect(workdayBoard("rbc.wd3.rbcglobal1")).toEqual({
    tenant: "rbc",
    origin: "https://rbc.wd3.myworkdayjobs.com",
    site: "rbcglobal1",
  });
  expect(workdayBoard("rbc")).toBeNull();
  expect(workdayBoard("../x.wd3.site")).toBeNull();
});

it("dates relative posting labels, keeping 30+ days old", () => {
  expect(workdayPostedAt("Posted Today", NOW)?.getTime()).toBe(NOW);
  expect(workdayPostedAt("Posted Yesterday", NOW)?.getTime()).toBe(NOW - DAY);
  expect(workdayPostedAt("Posted 3 Days Ago", NOW)?.getTime()).toBe(NOW - 3 * DAY);
  expect(workdayPostedAt("Posted 30+ Days Ago", NOW)?.getTime()).toBe(NOW - 31 * DAY);
  expect(workdayPostedAt(null, NOW)).toBeNull();
});

it("pages through the board and builds job links", async () => {
  const offsets: number[] = [];
  const posting = (n: number) => ({
    title: `Engineer ${n}`,
    externalPath: `/job/Toronto/Engineer_R${n}`,
    locationsText: n === 0 ? "2 Locations" : "Toronto, Ontario, Canada",
    postedOn: "Posted Today",
    bulletFields: [`R-000${n}000`],
  });
  const { jobs, complete } = await workday(
    async (url, init) => {
      expect(url).toBe("https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcglobal1/jobs");
      const { offset } = JSON.parse(String(init?.body)) as { offset: number };
      offsets.push(offset);
      const count = offset === 0 ? 20 : 5;
      return {
        total: offset === 0 ? 25 : 0,
        jobPostings: Array.from({ length: count }, (_, i) =>
          offset + i === 24 ? { title: null } : posting(offset + i),
        ),
      };
    },
    "rbc.wd3.rbcglobal1",
    "RBC",
    { detailBudget: 0 },
  );
  expect(offsets).toEqual([0, 20]);
  // 25 rows were read, placeholder included, so the board is complete.
  expect(complete).toBe(true);
  expect(jobs).toHaveLength(24);
  expect(jobs[0]?.location).toBe("");
  expect(jobs[1]).toMatchObject({
    company: "RBC",
    location: "Toronto, Ontario, Canada",
    url: "https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/Toronto/Engineer_R1",
    externalId: "Engineer_R1",
    requisitionId: "R-0001000",
  });
});

it("marks a board truncated when fewer rows arrive than it reports", async () => {
  const board = await workday(
    async () => ({ total: 60, jobPostings: [] }),
    "rbc.wd3.rbcglobal1",
    "RBC",
  );
  expect(board).toMatchObject({ reported: 60, complete: false });
});

it("fills new jobs from the detail endpoint: description, start date and every city", async () => {
  const requested: string[] = [];
  const { jobs } = await workday(
    async (url) => {
      requested.push(url);
      if (url.endsWith("/jobs"))
        return {
          total: 2,
          jobPostings: [1, 2].map((n) => ({
            title: `Analyst ${n}`,
            externalPath: `/job/Toronto/Analyst_JR${n}`,
            locationsText: "2 Locations",
            postedOn: "Posted 30+ Days Ago",
          })),
        };
      return {
        jobPostingInfo: {
          jobDescription: "<p>Analyze risk.</p>",
          startDate: "2026-08-02",
          jobReqId: "JR-1042",
          location: "Toronto, Ontario, Canada",
          additionalLocations: ["Montreal, Quebec, Canada"],
        },
      };
    },
    "rbc.wd3.rbcearlytalent1",
    "RBC",
    {
      describedUrls: async () =>
        new Set(["https://rbc.wd3.myworkdayjobs.com/rbcearlytalent1/job/Toronto/Analyst_JR2"]),
    },
  );
  expect(requested.slice(1)).toEqual([
    "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcearlytalent1/job/Toronto/Analyst_JR1",
  ]);
  expect(jobs[0]).toMatchObject({
    description: "Analyze risk.",
    postedAt: new Date("2026-08-02T00:00:00.000Z"),
    location: "Toronto, Ontario, Canada; Montreal, Quebec, Canada",
    requisitionId: "JR-1042",
  });
  expect(jobs[1]).toMatchObject({ description: "", location: "" });
});

it("requests only families that are not clearly non-tech and trusts the filtered total", async () => {
  const bodies: { appliedFacets: Record<string, string[]>; limit: number }[] = [];
  const board = await workday(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.limit === 1)
        return {
          total: 1676,
          jobPostings: [],
          facets: [
            {
              facetParameter: "jobFamilyGroup",
              values: [
                { descriptor: "Personal & Commercial Banking", id: "banking" },
                { descriptor: "Technology Solutions", id: "tech" },
                { descriptor: "Operations", id: "ops" },
              ],
            },
          ],
        };
      return {
        total: 2,
        jobPostings: [1, 2].map((n) => ({
          title: `Developer ${n}`,
          externalPath: `/job/Toronto/Developer_R${n}`,
          locationsText: "Toronto",
          postedOn: "Posted Today",
        })),
      };
    },
    "td.wd3.td_bank_careers",
    "TD",
    { techOnly: true, detailBudget: 0 },
  );
  expect(bodies[1]?.appliedFacets).toEqual({ jobFamilyGroup: ["tech", "ops"] });
  expect(board).toMatchObject({ reported: 2, complete: true });
  expect(techFamilies([])).toEqual({});
});
