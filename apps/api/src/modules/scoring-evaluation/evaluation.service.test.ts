import { caseFixture, evaluationFixture, resultInput } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("immutable account-owned scoring evaluations", () => {
  it("snapshots blind contexts once and never changes production score/cache/status", async () => {
    const f = evaluationFixture();
    const production = structuredClone(f.production);
    const [a, b] = await Promise.all([
      f.service.create(f.userId, f.input, "agent"),
      f.service.create(f.userId, f.input, "agent"),
    ]);
    expect(a.id).toBe(b.id);
    expect(f.tables.runs).toHaveLength(1);
    expect(f.tables.cases).toHaveLength(1);
    const rows = await f.service.cases(f.userId, a.id, { page: 1, limit: 1 });
    expect(rows.items[0].context.cachedAssessment).toBeNull();
    expect(rows.items[0].historicalReference?.score).toBe(100);
    expect(rows.pagination.total).toBe(1);
    expect((await f.service.list(f.userId, { page: 2, limit: 1 })).items).toHaveLength(0);
    expect((await f.service.report(f.userId, a.id)).unrunCases).toBe(1);
    expect(f.production).toEqual(production);
    await expect(
      f.service.create(f.userId, { ...f.input, name: "different" }, "agent"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects foreign, stale, duplicate and unconfirmed-fact inputs atomically", async () => {
    const f = evaluationFixture();
    await expect(f.service.create(crypto.randomUUID(), f.input, "agent")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.service.create(
        f.userId,
        {
          ...f.input,
          cases: [
            {
              ...f.input.cases[0],
              expectedBasis: { ...f.input.cases[0].expectedBasis, jobSha256: "f".repeat(64) },
            },
          ],
        },
        "agent",
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service.create(
        f.userId,
        { ...f.input, cases: [f.input.cases[0], f.input.cases[0]] },
        "agent",
      ),
    ).rejects.toThrow();
    const facts = { countryCode: "CA", confirmed: true as const, requiresSponsorship: true };
    await expect(
      f.service.create(f.userId, { ...f.input, cases: [{ ...f.input.cases[0], facts }] }, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.create(
        f.userId,
        { ...f.input, cases: [{ ...f.input.cases[0], facts: { ...facts, countryCode: "ZZ" } }] },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.tables.runs).toHaveLength(0);
    expect(f.tables.cases).toHaveLength(0);
    const run = await f.service.create(
      f.userId,
      { ...f.input, cases: [{ ...f.input.cases[0], facts }] },
      "session_user",
    );
    const row = (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0];
    expect(row.factsConfirmedAt).toBeInstanceOf(Date);
    expect(row.eligibility.facts).toEqual(facts);
  });
  it("stores idempotent immutable slots and refuses cross-account or revised replay", async () => {
    const f = evaluationFixture();
    const run = await f.service.create(f.userId, f.input, "agent");
    const row = (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0];
    const input = resultInput(row);
    const [a, b] = await Promise.all([
      f.service.result(f.userId, row.id, input),
      f.service.result(f.userId, row.id, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("completed");
    expect(f.tables.results).toHaveLength(1);
    await expect(
      f.service.result(f.userId, row.id, { ...input, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service.result(f.userId, row.id, { ...input, modelVersion: "changed" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(f.service.result(crypto.randomUUID(), row.id, input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.service.detail(crypto.randomUUID(), run.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.service.cases(crypto.randomUUID(), run.id, { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.service.report(crypto.randomUUID(), run.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(f.production.matchScore).toBe(100);
  });
  it("retains invalid exact-quote output as a rejected slot instead of accepting or retrying it", async () => {
    const f = evaluationFixture();
    const run = await f.service.create(f.userId, f.input, "agent");
    const row = (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0];
    const input = resultInput(row);
    input.judgments!.assessments.find((item) => item.evidence.length)!.evidence[0].quote =
      "Invented source";
    const saved = await f.service.result(f.userId, row.id, input);
    expect(saved.status).toBe("rejected");
    expect(saved.failureCode).toBe("invalid_output");
    expect(saved.assessment).toBeNull();
    expect((await f.service.report(f.userId, run.id)).failedCases).toBe(1);
    await expect(f.service.result(f.userId, row.id, resultInput(row))).rejects.toMatchObject({
      status: 409,
    });
  });
  it("preserves historical reference and source snapshot after the current source changes", async () => {
    const f = evaluationFixture();
    const run = await f.service.create(f.userId, f.input, "agent");
    const row = (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0];
    f.source.resume.text = "changed later";
    f.production.fitAssessment = null as never;
    const input = {
      ...resultInput(row),
      origin: "historical" as const,
      judgments: null,
      telemetry: { ...resultInput(row).telemetry, provenance: "unavailable" as const },
    };
    const saved = await f.service.result(f.userId, row.id, input);
    expect(saved.assessment).toEqual(row.historicalReference);
    expect(saved.actualModels).toEqual([]);
    expect(
      (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0].context.resume
        .text,
    ).toBe(row.context.resume.text);
    expect((await f.service.report(f.userId, run.id)).measuredPairs).toBe(0);
  });
  it("rejects wrong context identity and slot model before occupying a result slot", async () => {
    const f = evaluationFixture();
    const run = await f.service.create(f.userId, f.input, "agent");
    const row = (await f.service.cases(f.userId, run.id, { page: 1, limit: 25 })).items[0];
    await expect(
      f.service.result(f.userId, row.id, {
        ...resultInput(row),
        expectedContextHash: caseFixture().contextHash.replace(/^./, "f"),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service.result(f.userId, row.id, { ...resultInput(row), requestedModel: "haiku" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.tables.results).toHaveLength(0);
  });
});
