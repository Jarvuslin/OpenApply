import { taleo, taleoSection } from "./taleo";
import { expect, it } from "bun:test";

it("reads a section slug as tenant and section", () => {
  expect(taleoSection("uab/ext")).toEqual({ origin: "https://uab.taleo.net", section: "ext" });
  expect(taleoSection("uab")).toBeNull();
  expect(taleoSection("evil.example/ext")).toBeNull();
});

const searchPage = `<script>queryString: 'lang=en&amp;portal=8100108034',</script>`;
const detailPage = `<input type="hidden" id="initialHistory" value="ftlx0!|!RN!|!CGM0001A!|!!*!%3Cp%3EProvide care%5C: day shift.%3C/p%3E!|!!*!%3Cp%3EProvide care%5C: day shift.%3C/p%3E!|!false" />`;

it("pages the job board API and reads the posting date, places and requisition", async () => {
  const pages: number[] = [];
  const job = (n: number) => ({
    jobId: String(328000 + n),
    contestNo: n === 0 ? "CGM0001A" : "See posting",
    column: [
      `RN &amp; Educator ${n}`,
      n === 0 ? '["US-AL-Birmingham","Multiple Locations"]' : '["Multiple Locations"]',
      n === 0 ? "Oct 13, 2026" : "10/16/26",
      "Dec 31, 2099",
    ],
    linkedColumn: 0,
    locationsColumns: [1],
  });
  const fetchText = async (url: string) => {
    if (url.endsWith("/jobsearch.ftl?lang=en")) return searchPage;
    expect(url).toStartWith("https://uab.taleo.net/careersection/ext/jobdetail.ftl?job=");
    return detailPage;
  };
  const { jobs, reported, complete } = await taleo(
    async (url, init) => {
      expect(url).toBe(
        "https://uab.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=8100108034",
      );
      const { pageNo } = JSON.parse(String(init?.body));
      pages.push(pageNo);
      const count = pageNo === 1 ? 25 : 2;
      return {
        pagingData: { totalCount: 28 },
        requisitionList: Array.from({ length: count }, (_, i) => job((pageNo - 1) * 25 + i)),
      };
    },
    fetchText,
    "uab/ext",
    "UAB",
  );
  expect(pages).toEqual([1, 2]);
  expect(jobs).toHaveLength(27);
  expect(reported).toBe(28);
  expect(complete).toBe(false);
  expect(jobs[0]).toEqual({
    title: "RN & Educator 0",
    company: "UAB",
    location: "US-AL-Birmingham",
    url: "https://uab.taleo.net/careersection/ext/jobdetail.ftl?job=328000&lang=en",
    attributionUrl: "https://uab.taleo.net/careersection/ext/jobdetail.ftl?job=328000&lang=en",
    externalId: "328000",
    requisitionId: "CGM0001A",
    description: "Provide care: day shift.",
    postedAt: new Date("2026-10-13T00:00:00Z"),
  });
  // The future date is a closing date, never a posting date.
  expect(jobs[1]).toMatchObject({
    location: "",
    requisitionId: undefined,
    postedAt: new Date("2026-10-16T00:00:00Z"),
  });
});

it("refuses a section still on the older search page", async () => {
  await expect(
    taleo(
      async () => ({}),
      async () => "<html>listRequisition</html>",
      "baptisthlth/2",
    ),
  ).rejects.toThrow("no job board API");
});
