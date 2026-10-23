import { icims } from "./icims";
import { expect, it } from "bun:test";

const card = (id: number, dated: boolean) => `<li class="iCIMS_JobCardItem"> <div class="row">
  <div class="col-xs-6 header left"> <span class="sr-only field-label">Job Locations</span> <span > US-NC-Cary</span> </div>
  ${dated ? `<div class="col-xs-6 header right"> <span title="10/17/2026 1:02 PM"> 2 hours ago</span> </div>` : ""}
  <div class="col-xs-12 title"> <a href="https://careers-acme.icims.com/jobs/${id}/software-developer/job?in_iframe=1" class="iCIMS_Anchor">
  <span class="sr-only field-label">External Job Posting Title</span> <h3 > Software Developer &amp; Analyst</h3> </a> </div>
  <div class="col-xs-12 description"> Build things...</div>
  <dl class="iCIMS_JobHeaderGroup"><dt class="iCIMS_JobHeaderField">Requisition ID</dt> <dd class="iCIMS_JobHeaderData"><span > 2026-${id}</span> </dd></dl>
  </div> </li>`;
const jobPage = `<script type="application/ld+json">{"@type":"JobPosting","title":"Software Developer",
  "datePosted":"2026-10-15T04:00:00.000Z","description":"<p>Build the whole thing.</p>",
  "jobLocation":[{"@type":"Place","address":{"addressLocality":"Cary","addressRegion":"NC","addressCountry":"US"}}]}</script>`;

it("pages the search, reads each card, and takes undated jobs' dates from the job page", async () => {
  const urls: string[] = [];
  const { jobs, complete } = await icims(
    async (url) => {
      urls.push(url);
      if (url.endsWith("?in_iframe=1")) return jobPage;
      const page = Number(/pr=(\d+)/.exec(url)?.[1]);
      // The second page repeats the first page's last job, as a moving list does.
      return `<div>Page ${page + 1} of 2</div>${page === 0 ? card(1, true) + card(2, false) : card(2, false) + card(3, false)}`;
    },
    "careers-acme",
    "Acme",
  );
  expect(urls.slice(0, 2)).toEqual([
    "https://careers-acme.icims.com/jobs/search?ss=1&in_iframe=1&pr=0",
    "https://careers-acme.icims.com/jobs/search?ss=1&in_iframe=1&pr=1",
  ]);
  expect(jobs.map((job) => job.externalId)).toEqual(["1", "2", "3"]);
  expect(complete).toBe(true);
  expect(jobs[0]).toEqual({
    title: "Software Developer & Analyst",
    company: "Acme",
    location: "US-NC-Cary",
    countries: ["US"],
    url: "https://careers-acme.icims.com/jobs/1/software-developer/job",
    attributionUrl: "https://careers-acme.icims.com/jobs/1/software-developer/job",
    externalId: "1",
    requisitionId: "2026-1",
    description: "Build the whole thing.",
    // The list's own time stays; the job page's date is only for jobs the list leaves undated.
    postedAt: new Date("2026-10-17T13:02:00Z"),
  });
  expect(jobs[1]?.postedAt).toEqual(new Date("2026-10-15T04:00:00.000Z"));
});

it("ignores the placeholder date a portal that hides posting dates puts on its job pages", async () => {
  const placeholder = new Date();
  placeholder.setUTCFullYear(placeholder.getUTCFullYear() - 2);
  const page = jobPage.replace("2026-10-15T04:00:00.000Z", placeholder.toISOString());
  const { jobs } = await icims(
    async (url) => (url.endsWith("?in_iframe=1") ? page : card(2, false)),
    "careers-acme",
  );
  expect(jobs[0]?.postedAt).toBeNull();
  expect(jobs[0]?.description).toBe("Build the whole thing.");
});

it("refuses a slug that isn't a portal subdomain", async () => {
  await expect(icims(async () => "", "evil.example/x")).rejects.toThrow("Invalid iCIMS portal");
});
