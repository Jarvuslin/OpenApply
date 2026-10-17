import { oracle, oracleSite } from "./oracle";
import { expect, it } from "bun:test";

it("reads a site slug as the tenant host and site number", () => {
  expect(oracleSite("eeho.fa.us2.oraclecloud.com/CX_45001")).toEqual({
    host: "eeho.fa.us2.oraclecloud.com",
    site: "CX_45001",
  });
  expect(oracleSite("eeho.fa.us2.oraclecloud.com")).toBeNull();
  expect(oracleSite("evil.example/CX_1")).toBeNull();
  expect(oracleSite("eeho.fa.us2.oraclecloud.com/../CX_1")).toBeNull();
});

const api = "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest";
const job = (n: number) => ({
  Id: 300000 + n,
  Title: `Software Developer &amp; Analyst ${n}`,
  PostedDate: "2026-10-16",
  PrimaryLocation: "Toronto, ON, Canada",
  PrimaryLocationCountry: "CA",
  WorkplaceType: n === 0 ? "Hybrid" : null,
  ShortDescriptionStr: n === 0 ? "" : `<p>${"Build things. ".repeat(20)}</p>`,
  ExternalResponsibilitiesStr: null,
  ExternalQualificationsStr: null,
  secondaryLocations: n === 0 ? [{ Name: "Austin, TX, United States", CountryCode: "US" }] : [],
});

it("pages requisitions to the reported total, even past a page that comes back a row short", async () => {
  const offsets: number[] = [];
  const { jobs, reported, complete } = await oracle(
    async (url) => {
      expect(url).toStartWith(`${api}/recruitingCEJobRequisitions?`);
      expect(url).toContain("siteNumber=CX_45001,limit=200");
      const offset = Number(/offset=(\d+)/.exec(url)?.[1]);
      offsets.push(offset);
      const count = { 0: 199, 200: 200, 400: 3 }[offset] ?? 0;
      const list = Array.from({ length: count }, (_, i) => job(offset + i + 1));
      return { items: [{ TotalJobsCount: 403, requisitionList: list }] };
    },
    "eeho.fa.us2.oraclecloud.com/CX_45001",
    "Oracle",
  );
  expect(offsets).toEqual([0, 200, 400]);
  expect(jobs).toHaveLength(402);
  expect(reported).toBe(403);
  expect(complete).toBe(false);
});

it("reads a job whose list description is empty from its detail, with the exact posting time", async () => {
  const details: string[] = [];
  const { jobs } = await oracle(
    async (url) => {
      if (url.includes("recruitingCEJobRequisitionDetails")) {
        details.push(url);
        return {
          items: [
            {
              ExternalPostedStartDate: "2026-10-17T00:02:00+00:00",
              ExternalDescriptionStr: "<p>Build the pricing engine.</p>",
              ExternalResponsibilitiesStr: "<ul><li>Ship code</li></ul>",
              ExternalQualificationsStr: null,
            },
          ],
        };
      }
      return { items: [{ TotalJobsCount: 2, requisitionList: [job(0), job(1)] }] };
    },
    "eeho.fa.us2.oraclecloud.com/CX_45001",
    "Oracle",
  );
  expect(details).toEqual([
    `${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22300000%22,siteNumber=CX_45001`,
  ]);
  expect(jobs[0]).toEqual({
    title: "Software Developer & Analyst 0",
    company: "Oracle",
    location: "Toronto, ON, Canada; Austin, TX, United States",
    countries: ["CA", "US"],
    url: "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/300000",
    attributionUrl:
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/300000",
    externalId: "300000",
    requisitionId: "300000",
    description: "Build the pricing engine.\n\nShip code",
    postedAt: new Date("2026-10-17T00:02:00Z"),
    workMode: "hybrid",
  });
  expect(jobs[1]).toMatchObject({ postedAt: new Date("2026-10-16T00:00:00Z"), workMode: null });
});
