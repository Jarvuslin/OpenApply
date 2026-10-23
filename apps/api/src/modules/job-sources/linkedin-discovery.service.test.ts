import { claimed, LINKEDIN_JOB, linkedinFake, SEARCH } from "./linkedin-fakes";
import { describe, expect, it, spyOn } from "bun:test";

describe("owned daily LinkedIn discovery", () => {
  it("defaults off and atomically grants only one daily claim", async () => {
    const state = linkedinFake();
    expect(await state.service.settings("u1")).toEqual({
      enabled: false,
      searches: [],
      lastRunAt: null,
      nextRunAt: null,
      backoffUntil: null,
      lastRunStatus: null,
      lastCompletedAt: null,
      lastResult: null,
    });
    await expect(state.service.claim("u1")).rejects.toThrow("disabled");
    await state.service.configure("u1", { enabled: true, searches: [SEARCH] });
    const claims = await Promise.allSettled([state.service.claim("u1"), state.service.claim("u1")]);
    expect(claims.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(state.runs.size).toBe(1);
    expect(
      state.settings.get("u1")!.nextRunAt!.getTime() -
        state.settings.get("u1")!.lastRunAt!.getTime(),
    ).toBe(86_400_000);
  });

  it("rejects wrong owners, wrong leases, disabled settings and expired leases before resolution", async () => {
    const state = linkedinFake();
    const { payload } = await claimed(state);
    await expect(state.service.ingest("u2", payload)).rejects.toThrow("Discovery run");
    await expect(
      state.service.ingest("u1", { ...payload, leaseToken: "a".repeat(64) }),
    ).rejects.toThrow("Discovery run");
    state.settings.get("u1")!.enabled = false;
    await expect(state.service.ingest("u1", payload)).rejects.toThrow("disabled");
    state.settings.get("u1")!.enabled = true;
    state.runs.get(payload.runId)!.leaseExpiresAt = new Date(0);
    await expect(state.service.ingest("u1", payload)).rejects.toThrow("expired");
    expect(state.resolutionCount()).toBe(0);
    expect(state.published).toHaveLength(0);
  });

  it("replays a completed response without republishing and rejects changed payloads", async () => {
    const state = linkedinFake();
    const { payload } = await claimed(state);
    const result = await state.service.ingest("u1", payload);
    expect(result).toMatchObject({ imported: 1, resolved: 1, unresolved: 0, filtered: 0 });
    expect(await state.service.ingest("u1", payload)).toEqual(result);
    expect(state.published).toHaveLength(1);
    expect(state.resolutionCount()).toBe(1);
    expect(await state.service.settings("u1")).toMatchObject({
      lastRunStatus: "completed",
      lastResult: { imported: 1, fetched: 1, pagesFetched: 1 },
    });
    const changed = { ...payload, searches: [{ ...payload.searches[0]!, jobs: [] }] };
    await expect(state.service.ingest("u1", changed)).rejects.toThrow("different result");
  });

  it("persists backoff for blocked, error and non-200 responses including an empty result", async () => {
    for (const response of [
      { status: "blocked" as const, httpStatus: 429 },
      { status: "error" as const },
      { status: "ok" as const, httpStatus: 403 },
    ]) {
      const state = linkedinFake();
      const { payload } = await claimed(state);
      payload.searches = [{ index: 0, pagesFetched: 0, jobs: [], ...response }];
      const result = await state.service.ingest("u1", payload);
      expect(result.backoffUntil!.getTime()).toBeGreaterThan(Date.now() + 86_390_000);
      await state.service.configure("u1", { enabled: true, searches: [SEARCH] });
      expect((await state.service.settings("u1")).backoffUntil).toEqual(result.backoffUntil);
      await expect(state.service.claim("u1")).rejects.toThrow("not due");
    }
  });

  it("requires the claimed snapshot indices and keeps those search rules despite later edits", async () => {
    const state = linkedinFake();
    const { payload } = await claimed(state, [SEARCH, { ...SEARCH, query: "associate engineer" }]);
    await expect(
      state.service.ingest("u1", { ...payload, searches: [payload.searches[0]!] }),
    ).rejects.toThrow("exactly once");
    await state.service.configure("u1", {
      enabled: true,
      searches: [{ ...SEARCH, location: "Seattle, United States" }],
    });
    expect((await state.service.ingest("u1", payload)).imported).toBe(1);
  });

  it("dedupes overlapping saved searches and LinkedIn IDs resolving to the same employer job", async () => {
    const state = linkedinFake();
    const { payload } = await claimed(state, [SEARCH, SEARCH]);
    payload.searches[0]!.jobs.push({
      ...LINKEDIN_JOB,
      url: "https://ca.linkedin.com/jobs/view/engineer-123?trk=abc",
    });
    payload.searches[1]!.jobs.push({
      ...LINKEDIN_JOB,
      url: "https://www.linkedin.com/jobs/view/456",
    });
    expect((await state.service.ingest("u1", payload)).imported).toBe(1);
    expect(state.resolutionCount()).toBe(2);
    expect(state.published).toHaveLength(1);
  });

  it("uses employer requirements for filtering and enrichment", async () => {
    const rejected = linkedinFake({ employer: { description: "7 years of experience required" } });
    const rejectedRun = await claimed(rejected);
    expect((await rejected.service.ingest("u1", rejectedRun.payload)).filtered).toBe(1);
    expect(rejected.published).toHaveLength(0);
    const state = linkedinFake({
      employer: {
        salary: "CAD 75000-90000 /year",
        type: "Full-time",
        description: "2 years of professional experience",
        countries: ["CA"],
      },
    });
    const { payload } = await claimed(state);
    await state.service.ingest("u1", payload);
    expect(state.published[0]).toMatchObject({
      userId: "u1",
      job: {
        salary: "CAD 75000-90000 /year",
        countries: ["CA"],
        description: "2 years of professional experience",
        applyUrl: "https://jobs.lever.co/acme/abc",
      },
    });
  });

  it("stores unresolved entry roles privately with no queueable LinkedIn URL", async () => {
    const state = linkedinFake({ unresolved: true });
    const { payload } = await claimed(state);
    const result = await state.service.ingest("u1", payload);
    expect(result).toMatchObject({ imported: 1, unresolved: 1, resolved: 0 });
    expect(state.published[0]).toMatchObject({
      userId: "u1",
      job: {
        board: "linkedin-jobspy",
        url: "https://www.linkedin.com/jobs/view/123",
        applyUrl: null,
        resolutionConfidence: 0,
      },
    });
  });

  it("retains unresolved ordinary titles without claiming they passed employer filtering", async () => {
    const state = linkedinFake({ unresolved: true });
    const { payload } = await claimed(state);
    payload.searches[0]!.jobs = [{ ...LINKEDIN_JOB, title: "Software Engineer", description: "" }];
    expect(await state.service.ingest("u1", payload)).toMatchObject({
      imported: 1,
      unresolved: 1,
      resolved: 0,
      filtered: 0,
    });
    expect(state.published[0]!.job.applyUrl).toBeNull();
  });

  it("keeps a failed ingest retryable with the same payload", async () => {
    let failures = 1;
    const state = linkedinFake({
      onPublish: () => {
        if (failures-- > 0) throw new Error("temporary write failure");
      },
    });
    const { payload } = await claimed(state);
    await expect(state.service.ingest("u1", payload)).rejects.toThrow("temporary write failure");
    expect(state.runs.get(payload.runId)?.status).toBe("claimed");
    expect((await state.service.ingest("u1", payload)).imported).toBe(1);
  });

  it("stops starting resolver work after the budget and retains remaining jobs unresolved", async () => {
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const state = linkedinFake({
        onResolve: () => {
          now += 90_001;
        },
      });
      const { payload } = await claimed(state);
      payload.searches[0]!.jobs = [1, 2, 3, 4, 5].map((id) => ({
        ...LINKEDIN_JOB,
        url: `https://www.linkedin.com/jobs/view/${id}`,
      }));
      const result = await state.service.ingest("u1", payload);
      expect(state.resolutionCount()).toBe(1);
      expect(result).toMatchObject({ imported: 5, resolved: 1, unresolved: 4, filtered: 0 });
    } finally {
      clock.mockRestore();
    }
  });
});
