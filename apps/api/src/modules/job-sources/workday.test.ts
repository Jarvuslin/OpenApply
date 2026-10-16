import { workday, workdayBoard, workdayPostedAt } from "./workday";
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
  });
  const jobs = await workday(
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
  );
  expect(offsets).toEqual([0, 20]);
  expect(jobs).toHaveLength(24);
  expect(jobs[0]?.location).toBe("");
  expect(jobs[1]).toMatchObject({
    company: "RBC",
    location: "Toronto, Ontario, Canada",
    url: "https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/Toronto/Engineer_R1",
  });
});
