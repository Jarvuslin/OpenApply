import { buildListingDraft } from "@/modules/job-listing/listing-draft";
import { fetchAts } from "./ats";
import { expect, it } from "bun:test";

it("imports all five public ATS shapes with their own job ids, without inventing skills", async () => {
  const cases = {
    ashby: {
      jobs: [
        {
          id: "a1",
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
          id: 101,
          title: "Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "Toronto" },
          content: "<p>Build products</p>",
          requisition_id: "REQ-1234",
        },
      ],
      meta: { total: 1 },
    },
    lever: [
      {
        id: "l1",
        text: "Engineer",
        hostedUrl: "https://jobs.lever.co/acme/1",
        categories: { location: "Toronto", allLocations: ["Toronto", "Remote"] },
      },
    ],
    smartrecruiters: {
      totalFound: 1,
      content: [
        { id: "1", name: "Engineer", refNumber: "JB0076217", location: { city: "Toronto" } },
      ],
    },
    workable: {
      jobs: [
        {
          title: "Engineer",
          shortcode: "81B46579FE",
          shortlink: "https://apply.workable.com/acme/j/1",
          city: "Toronto",
        },
      ],
    },
  };
  const ids = {
    ashby: "a1",
    greenhouse: "101",
    lever: "l1",
    smartrecruiters: "1",
    workable: "81B46579FE",
  };
  for (const provider of Object.keys(cases) as (keyof typeof cases)[]) {
    const board = await fetchAts(async () => cases[provider], provider, "acme");
    expect(board.complete).toBe(true);
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0]!.url).toStartWith("https://");
    expect(board.jobs[0]!.externalId).toBe(ids[provider]);
    expect(buildListingDraft({ ...board.jobs[0]!, publicFeed: true })?.skills).toEqual([]);
  }
  const greenhouse = await fetchAts(async () => cases.greenhouse, "greenhouse", "acme");
  expect(greenhouse.jobs[0]!.requisitionId).toBe("REQ-1234");
  const smart = await fetchAts(async () => cases.smartrecruiters, "smartrecruiters", "acme");
  expect(smart.jobs[0]!.requisitionId).toBe("JB0076217");
});

it("ignores a placeholder requisition field", async () => {
  const board = await fetchAts(
    async () => ({
      jobs: [
        {
          id: 1,
          title: "Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "Toronto" },
          requisition_id: "See Opening ID",
        },
      ],
    }),
    "greenhouse",
    "acme",
  );
  expect(board.jobs[0]!.requisitionId).toBeUndefined();
});

it("paginates SmartRecruiters until a short page", async () => {
  const urls: string[] = [];
  const board = await fetchAts(
    async (url) => {
      urls.push(url);
      return {
        totalFound: 100,
        content:
          urls.length === 1
            ? Array.from({ length: 100 }, (_, id) => ({ id, name: "Engineer" }))
            : [],
      };
    },
    "smartrecruiters",
    "acme",
  );
  expect(board.jobs).toHaveLength(100);
  expect(board.complete).toBe(true);
  expect(urls[1]).toContain("offset=100");
});

it("marks SmartRecruiters truncated at its page cap or when fewer jobs arrive than reported", async () => {
  const full = await fetchAts(
    async () => ({ content: Array.from({ length: 100 }, (_, id) => ({ id, name: "Engineer" })) }),
    "smartrecruiters",
    "acme",
  );
  expect(full.jobs).toHaveLength(5000);
  expect(full.complete).toBe(false);
  const short = await fetchAts(
    async () => ({ totalFound: 40, content: [{ id: 1, name: "Engineer" }] }),
    "smartrecruiters",
    "acme",
  );
  expect(short).toMatchObject({ reported: 40, complete: false });
});

it("pages Lever with skip and limit instead of one unbounded response", async () => {
  const urls: string[] = [];
  const board = await fetchAts(
    async (url) => {
      urls.push(url);
      const skip = Number(new URL(url).searchParams.get("skip"));
      const count = skip === 0 ? 100 : 7;
      return Array.from({ length: count }, (_, i) => ({
        id: `l${skip + i}`,
        text: "Engineer",
        hostedUrl: `https://jobs.lever.co/acme/${skip + i}`,
        descriptionPlain: "Requisition ID: JR123456",
      }));
    },
    "lever",
    "acme",
  );
  expect(urls.map((url) => new URL(url).searchParams.get("skip"))).toEqual(["0", "100"]);
  expect(board.jobs).toHaveLength(107);
  expect(board.complete).toBe(true);
  expect(board.jobs[0]!.requisitionId).toBe("JR123456");
});

it("rejects board path injection and malformed feeds", async () => {
  await expect(fetchAts(async () => ({}), "ashby", "../secret")).rejects.toThrow();
  await expect(
    fetchAts(async () => ({ jobs: [{ title: "No URL" }] }), "greenhouse", "acme"),
  ).rejects.toThrow();
});

it("retains Workable requirements and benefits alongside the full description", async () => {
  const board = await fetchAts(
    async () => ({
      jobs: [
        {
          title: "Engineer",
          shortcode: "ABC123",
          shortlink: "https://apply.workable.com/acme/j/1",
          description: "<p>Build software.</p>",
          requirements: "<p>Python experience.</p>",
          benefits: "<p>Remote in Canada.</p>",
        },
      ],
    }),
    "workable",
    "acme",
  );
  expect(board.jobs[0]!.description).toBe(
    "Build software.\n\nPython experience.\n\nRemote in Canada.",
  );
});
