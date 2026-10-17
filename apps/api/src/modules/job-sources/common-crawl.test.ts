import { checkBoard, latestCrawl } from "./common-crawl";
import { expect, it } from "bun:test";

it("picks the newest crawl the download host lists", async () => {
  expect(
    await latestCrawl(
      async () =>
        '<a href="CC-MAIN-2026-30/index.html">CC-MAIN-2026-30</a> <a>CC-MAIN-2026-39</a> CC-MAIN-2025-51',
    ),
  ).toBe("CC-MAIN-2026-39");
});

it("checks a found board with one request and keeps it only when it lists jobs", async () => {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    if (url.includes("greenhouse")) return { jobs: [{ company_name: "Acme Robotics" }] };
    if (url.includes("ashbyhq")) return { jobs: [] };
    if (url.includes("lever")) return [{ id: "1" }];
    return { total: 4, jobPostings: [] };
  };
  expect(await checkBoard(fetch, { provider: "greenhouse", slug: "acmerobotics" })).toEqual({
    provider: "greenhouse",
    slug: "acmerobotics",
    company: "Acme Robotics",
  });
  expect(await checkBoard(fetch, { provider: "ashby", slug: "quiet" })).toBeNull();
  expect(await checkBoard(fetch, { provider: "lever", slug: "tiny-co" })).toMatchObject({
    company: "Tiny Co",
  });
  expect(await checkBoard(fetch, { provider: "workday", slug: "acme.wd5.External" })).toMatchObject(
    { company: "Acme" },
  );
  expect(requested).toEqual([
    "https://boards-api.greenhouse.io/v1/boards/acmerobotics/jobs",
    "https://api.ashbyhq.com/posting-api/job-board/quiet",
    "https://api.lever.co/v0/postings/tiny-co?mode=json&limit=1",
    "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs",
  ]);
});
