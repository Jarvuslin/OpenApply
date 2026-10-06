import { buildListingDraft } from "@/modules/job-listing/listing-draft";
import { fetchAts } from "./ats";
import { expect, it } from "bun:test";

it("imports all five public ATS shapes without inventing skills", async () => {
  const cases = {
    ashby: {
      jobs: [
        {
          title: "Account Executive",
          location: "Toronto",
          jobUrl: "https://jobs.ashbyhq.com/acme/1",
          applyUrl: "https://jobs.ashbyhq.com/acme/1/application",
        },
      ],
    },
    greenhouse: {
      jobs: [
        {
          title: "Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "Toronto" },
          content: "<p>Build products</p>",
        },
      ],
    },
    lever: [
      {
        text: "Engineer",
        hostedUrl: "https://jobs.lever.co/acme/1",
        categories: { location: "Toronto", allLocations: ["Toronto", "Remote"] },
      },
    ],
    smartrecruiters: { content: [{ id: "1", name: "Engineer", location: { city: "Toronto" } }] },
    workable: {
      jobs: [
        { title: "Engineer", shortlink: "https://apply.workable.com/acme/j/1", city: "Toronto" },
      ],
    },
  };
  for (const provider of Object.keys(cases) as (keyof typeof cases)[]) {
    const jobs = await fetchAts(async () => cases[provider], provider, "acme");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toStartWith("https://");
    expect(buildListingDraft({ ...jobs[0], publicFeed: true })?.skills).toEqual([]);
  }
});
it("paginates SmartRecruiters until a short page", async () => {
  const urls: string[] = [];
  const jobs = await fetchAts(
    async (url) => {
      urls.push(url);
      return {
        content:
          urls.length === 1
            ? Array.from({ length: 100 }, (_, id) => ({ id, name: "Engineer" }))
            : [],
      };
    },
    "smartrecruiters",
    "acme",
  );
  expect(jobs).toHaveLength(100);
  expect(urls[1]).toContain("offset=100");
});
it("rejects board path injection and malformed feeds", async () => {
  await expect(fetchAts(async () => ({}), "ashby", "../secret")).rejects.toThrow();
  await expect(
    fetchAts(async () => ({ jobs: [{ title: "No URL" }] }), "greenhouse", "acme"),
  ).rejects.toThrow();
});
