import { greenhouse } from "./greenhouse";
import { expect, it } from "bun:test";

it("dates a posting by when it was first published, never by its last edit", async () => {
  const jobs = await greenhouse(
    async () => ({
      jobs: [
        {
          title: "Engineer",
          absolute_url: "https://boards.greenhouse.io/example/jobs/1",
          location: { name: "Toronto" },
          first_published: "2026-09-03T13:32:53-04:00",
          updated_at: "2026-10-07T12:00:00Z",
        },
        {
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
