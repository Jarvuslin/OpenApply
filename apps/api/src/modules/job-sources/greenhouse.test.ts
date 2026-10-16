import { greenhouse } from "./greenhouse";
import { SourceResponseError } from "./http";
import { expect, it } from "bun:test";

it("dates a posting by when it was first published, never by its last edit", async () => {
  const { jobs } = await greenhouse(
    async () => ({
      jobs: [
        {
          id: 1,
          title: "Engineer",
          absolute_url: "https://boards.greenhouse.io/example/jobs/1",
          location: { name: "Toronto" },
          first_published: "2026-09-03T13:32:53-04:00",
          updated_at: "2026-10-07T12:00:00Z",
        },
        {
          id: 2,
          title: "Designer",
          absolute_url: "https://boards.greenhouse.io/example/jobs/2",
          location: { name: "Toronto" },
          updated_at: "2026-10-07T12:00:00Z",
        },
      ],
    }),
    "example",
  );
  expect(jobs[0]?.postedAt?.toISOString()).toBe("2026-09-03T17:32:53.000Z");
  expect(jobs[1]?.postedAt).toBeNull();
});

it("reads an oversized board as a plain list and describes new jobs one at a time", async () => {
  const urls: string[] = [];
  const listed = (id: number) => ({
    id,
    title: `Engineer ${id}`,
    absolute_url: `https://boards.greenhouse.io/spacex/jobs/${id}`,
    location: { name: "Hawthorne, CA" },
    first_published: `2026-10-0${id}T00:00:00Z`,
  });
  const board = await greenhouse(
    async (url) => {
      urls.push(url);
      if (url.endsWith("?content=true"))
        throw new SourceResponseError("Discovery response is too large.", 200, 0, true);
      const detail = /\/jobs\/(\d+)$/.exec(url)?.[1];
      if (detail)
        return { ...listed(Number(detail)), content: "&lt;p&gt;Requisition ID: 12345&lt;/p&gt;" };
      return { jobs: [1, 2, 3].map(listed), meta: { total: 3 } };
    },
    "spacex",
    "SpaceX",
    {
      describedUrls: async () => new Set(["https://boards.greenhouse.io/spacex/jobs/3"]),
      detailBudget: 1,
    },
  );
  expect(board).toMatchObject({ reported: 3, complete: true });
  // Job 3 is already described; of 1 and 2, only the newest fits the budget.
  expect(urls.filter((url) => /\/jobs\/\d+$/.test(url))).toEqual([
    "https://boards-api.greenhouse.io/v1/boards/spacex/jobs/2",
  ]);
  expect(board.jobs.find((job) => job.externalId === "2")).toMatchObject({
    description: "Requisition ID: 12345",
    requisitionId: "12345",
  });
  expect(board.jobs.find((job) => job.externalId === "1")?.description).toBe("");
});
