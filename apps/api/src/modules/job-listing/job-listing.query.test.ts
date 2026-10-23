import { jobListingQuerySchema } from "@openapply/contracts/job-listing";
import { Elysia } from "elysia";
import { createApiClient } from "../../../../../packages/api-client/src/index";
import { describe, expect, it } from "bun:test";

const app = new Elysia().get("/api/jobs", ({ query }) => query, { query: jobListingQuerySchema });

async function request(query: URLSearchParams) {
  return app.handle(new Request(`http://localhost/api/jobs?${query}`));
}

describe("job listing filter wire encoding", () => {
  it("preserves label boundaries through the actual Eden client with a typed JSON wrapper", async () => {
    let received: unknown;
    const fetcher = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = input instanceof Request ? input.url : String(input);
        const response = await app.handle(new Request(url, init));
        received = await response.clone().json();
        return response;
      },
      { preconnect: fetch.preconnect },
    );
    const client = createApiClient("http://localhost", {
      fetcher,
    });
    const result = await client.api.jobs.get({
      query: {
        page: 1,
        limit: 25,
        titles: [JSON.stringify(["Engineer, frontend"])],
        locations: [JSON.stringify(["London, UK", "Toronto, Ontario"])],
      },
    });
    expect(result.error).toBeNull();
    expect(received).toMatchObject({
      titles: ["Engineer, frontend"],
      locations: ["London, UK", "Toronto, Ontario"],
    });
  });

  it("preserves a singleton comma-containing location and title with JSON arrays", async () => {
    const response = await request(
      new URLSearchParams({
        locations: JSON.stringify(["London, UK"]),
        titles: JSON.stringify(["Engineer, frontend"]),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      locations: ["London, UK"],
      titles: ["Engineer, frontend"],
    });
  });

  it("preserves commas and item boundaries in multiple JSON-encoded filters", async () => {
    const response = await request(
      new URLSearchParams({
        locations: JSON.stringify(["London, UK", "Toronto, Ontario"]),
        titles: JSON.stringify(["Engineer, frontend", "Designer, product"]),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      locations: ["London, UK", "Toronto, Ontario"],
      titles: ["Engineer, frontend", "Designer, product"],
    });
  });

  it("retains existing CSV filters and repeated-array inputs", async () => {
    const csv = await request(
      new URLSearchParams({ locations: "Toronto,Vancouver", titles: "Frontend,Backend" }),
    );
    expect(csv.status).toBe(200);
    expect(await csv.json()).toMatchObject({
      locations: ["Toronto", "Vancouver"],
      titles: ["Frontend", "Backend"],
    });
    const repeated = await request(
      new URLSearchParams([
        ["locations", "London"],
        ["locations", "Toronto"],
        ["titles", "Engineer"],
        ["titles", "Designer"],
      ]),
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      locations: ["London", "Toronto"],
      titles: ["Engineer", "Designer"],
    });
  });

  it("rejects malformed JSON and invalid labels instead of widening a search", async () => {
    for (const locations of ['["London"', '["London",10]', '[""]']) {
      expect((await request(new URLSearchParams({ locations }))).status).toBe(422);
    }
  });
});
