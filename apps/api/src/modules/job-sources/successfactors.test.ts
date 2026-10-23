import { successfactors } from "./successfactors";
import { monthDayYear } from "./types";
import { expect, it } from "bun:test";

const row = (n: number) => `<tr class="data-row">
  <td class="colTitle"><span class="jobTitle hidden-phone">
    <a href="${n === 26 ? "/Tangerine" : ""}/job/Toronto-Developer-${n}-ON/14306645${n}/" class="jobTitle-link">Developer &amp; Analyst ${n}</a>
  </span><div class="jobdetail-phone visible-phone">
    <span class="jobLocation visible-phone"><span class="jobLocation">
      Toronto, ON, CA, M5H 1J9 +2 more…
    </span></span>
    <span class="jobDate visible-phone">Oct 15, 2026</span>
  </div></td>
  <td class="colLocation hidden-phone"><span class="jobLocation">Toronto, ON, CA, M5H 1J9</span></td>
  <td class="colDate hidden-phone"><span class="jobDate">Oct 15, 2026
  </span></td>
</tr>`;

it("reads month-day-year dates as UTC midnight", () => {
  expect(monthDayYear("Oct 15, 2026")?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  expect(monthDayYear("Sept 2, 2026")?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  expect(monthDayYear("soon")).toBeNull();
});

it("pages the newest-first search and reads each row", async () => {
  const urls: string[] = [];
  const { jobs, complete } = await successfactors(
    async (url) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get("startrow"));
      const count = start === 0 ? 25 : 2;
      const rows = Array.from({ length: count }, (_, i) => row(start + i)).join("");
      return `<span class="paginationLabel">Results <b>1 – 25</b> of <b>27</b></span><table>${rows}</table>`;
    },
    "jobs.rogers.com",
    "Rogers",
    { detailBudget: 0 },
  );
  expect(complete).toBe(true);
  expect(urls).toEqual([
    "https://jobs.rogers.com/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=0",
    "https://jobs.rogers.com/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=25",
  ]);
  expect(jobs).toHaveLength(27);
  expect(jobs[26]?.url).toBe(
    "https://jobs.rogers.com/Tangerine/job/Toronto-Developer-26-ON/1430664526/",
  );
  expect(jobs[1]).toEqual({
    title: "Developer & Analyst 1",
    company: "Rogers",
    location: "Toronto, ON, CA",
    url: "https://jobs.rogers.com/job/Toronto-Developer-1-ON/143066451/",
    attributionUrl: "https://jobs.rogers.com/job/Toronto-Developer-1-ON/143066451/",
    externalId: "143066451",
    description: "",
    postedAt: new Date("2026-10-15T00:00:00.000Z"),
  });
});

it("fills new jobs from their pages: full description, exact date and requisition", async () => {
  const page = `<span itemprop="datePosted" content="Thu Oct 15 07:00:00 UTC 2026"></span>
    <span itemprop="description" data-careersite-propertyid="description"><span class="jobdescription">
    <p>Build payment systems.</p><p>Requisition ID: 335014</p></span></span>
    <span data-careersite-propertyid="customfield1">Footer</span>`;
  const fetched: string[] = [];
  const { jobs } = await successfactors(
    async (url) => {
      fetched.push(url);
      if (url.includes("/job/")) return page;
      return `Results <b>1 – 2</b> of <b>2</b>${row(0)}${row(1)}`;
    },
    "jobs.rogers.com",
    "Rogers",
    {
      describedUrls: async () =>
        new Set(["https://jobs.rogers.com/job/Toronto-Developer-1-ON/143066451/"]),
    },
  );
  expect(fetched.filter((url) => url.includes("/job/"))).toEqual([
    "https://jobs.rogers.com/job/Toronto-Developer-0-ON/143066450/",
  ]);
  expect(jobs[0]).toMatchObject({
    description: "Build payment systems. Requisition ID: 335014",
    postedAt: new Date("2026-10-15T07:00:00.000Z"),
    requisitionId: "335014",
  });
  expect(jobs[1]?.description).toBe("");
});

it("rejects a slug that is not a hostname", async () => {
  await expect(successfactors(async () => "", "../etc", "X")).rejects.toThrow();
});
