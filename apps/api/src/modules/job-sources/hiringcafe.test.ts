import { hiringCafeSearch } from "./hiringcafe";
import { expect, it } from "bun:test";

const result = {
  jobs: [
    {
      title: "Backend Engineer",
      company: "Acme",
      location: "Remote, United States",
      workplaceType: "Remote",
      employmentTypes: ["Full Time"],
      compensation: { currency: "USD", frequency: "Yearly", minimum: 120000, maximum: 150000 },
      datePosted: "2026-10-07T12:00:00Z",
      requirementsSummary: "<p>Build APIs</p>",
      responsibilities: ["Own backend services"],
      technologies: ["TypeScript"],
      applyUrl: "https://hiringcafe.com/job/acme-1?utm_source=chatgpt",
    },
  ],
  total_matches: 5000,
};

it("calls only the documented HiringCafe search with bounded filters and retains attribution", async () => {
  let calls = 0;
  const data = await hiringCafeSearch(
    async (url, init) => {
      calls++;
      expect(url).toBe("https://hiringcafe.com/api/chatgpt/mcp");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        method: "tools/call",
        params: {
          name: "search_hiringcafe_jobs",
          arguments: {
            search: "backend",
            location: "United States",
            workplace_types: ["Remote"],
            limit: 25,
            posted_within_days: 7,
          },
        },
      });
      return { result: { structuredContent: result } };
    },
    { query: "backend", location: "United States", workModes: ["remote"], postedWithinDays: 7 },
  );
  expect(calls).toBe(1);
  expect(data.hasMore).toBe(false);
  expect(data.totalMatches).toBe(5000);
  expect(data.jobs[0]).toMatchObject({
    salary: "USD 120000-150000 /year",
    description: "Build APIs\n\nOwn backend services\n\nTypeScript",
    workMode: "remote",
    url: result.jobs[0]?.applyUrl,
    attributionUrl: result.jobs[0]?.applyUrl,
  });
});

it("rejects excessive result limits and tool errors without scheduling repeated searches", async () => {
  await expect(
    hiringCafeSearch(
      async () => {
        throw new Error("Should not fetch");
      },
      { limit: 26 },
    ),
  ).rejects.toThrow();
  await expect(hiringCafeSearch(async () => ({ error: { code: -1 } }), {})).rejects.toThrow(
    "could not complete",
  );
  await expect(hiringCafeSearch(async () => ({ result: { isError: true } }), {})).rejects.toThrow(
    "could not complete",
  );
  await expect(hiringCafeSearch(async () => ({ result: {} }), {})).rejects.toThrow();
});

it("returns empty results honestly and rejects offsite apply links", async () => {
  expect(
    await hiringCafeSearch(
      async () => ({ result: { structuredContent: { jobs: [], total_matches: 0 } } }),
      {},
    ),
  ).toEqual({ jobs: [], totalMatches: 0, hasMore: false });
  const data = await hiringCafeSearch(
    async () => ({
      result: {
        structuredContent: {
          ...result,
          jobs: [{ ...result.jobs[0], applyUrl: "https://example.test/job" }],
        },
      },
    }),
    {},
  );
  expect(data.jobs).toEqual([]);
});
