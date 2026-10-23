import { serpapiPage } from "./serpapi";
import { expect, it } from "bun:test";

it("uses the provider cursor for the next page and preserves attribution", async () => {
  let requested = "";
  const page = await serpapiPage(
    async (url) => {
      requested = url;
      return {
        jobs_results: [
          {
            title: "Engineer",
            company_name: "Example",
            share_link: "https://google.com/jobs/1",
            apply_options: [{ link: "https://example.com/careers/1" }],
          },
        ],
        serpapi_pagination: { next_page_token: "next-token" },
      };
    },
    "secret",
    { provider: "serpapi", query: "engineer", location: "US", limit: 20 },
    "previous-token",
  );
  expect(new URL(requested).searchParams.get("next_page_token")).toBe("previous-token");
  expect(page.nextCursor).toBe("next-token");
  expect(page.jobs[0]?.attributionUrl).toBe("https://google.com/jobs/1");
  expect(page.jobs[0]?.url).toBe("https://example.com/careers/1");
});

it("returns no further page without a token and rejects provider errors instead of claiming exhaustion", async () => {
  const input = { provider: "serpapi" as const, query: "engineer", location: "", limit: 20 };
  expect(await serpapiPage(async () => ({ jobs_results: [] }), "secret", input)).toEqual({
    jobs: [],
    nextCursor: null,
  });
  await expect(
    serpapiPage(async () => ({ error: "quota exceeded" }), "secret", input),
  ).rejects.toThrow("SerpApi connection");
});
