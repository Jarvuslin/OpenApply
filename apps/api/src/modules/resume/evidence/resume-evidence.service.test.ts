import "reflect-metadata";
import {
  type CreateResumeEvidence,
  createResumeEvidenceSchema,
} from "@openapply/contracts/resume-evidence";
import { fixture, input, now, resumeId, userId } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("ResumeEvidenceService ownership and provenance", () => {
  it("resolves reusable evidence into immutable artifact snapshots without modifying the base", async () => {
    const { service, base } = fixture();
    const before = structuredClone(base);
    const saved = await service.create(userId, resumeId, input());
    const [snapshot] = await service.resolve(userId, resumeId, [
      { evidenceId: saved.id, revision: 1 },
    ]);
    expect(snapshot.statement).toBe(input().statement);
    expect(snapshot.verification.resumeVersion).toBe(3);
    expect(snapshot.verification.scopeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.createdAt).toBe(now.toISOString());
    await service.correct(userId, resumeId, saved.id, {
      ...input(),
      status: "unverified",
      expectedRevision: 1,
    });
    expect(snapshot.status).toBe("supported");
    expect(snapshot.revision).toBe(1);
    expect(base).toEqual(before);
  });

  it("rejects another owner's resume before reading or writing evidence", async () => {
    const { service, rows } = fixture();
    await expect(service.create("other", resumeId, input())).rejects.toMatchObject({ status: 404 });
    await expect(service.list("other", resumeId, { page: 1, limit: 25 })).rejects.toMatchObject({
      status: 404,
    });
    expect(rows).toHaveLength(0);
  });

  it("retains optional questions without permitting them into a rewrite", async () => {
    const { service } = fixture();
    const saved = await service.create(userId, resumeId, {
      ...input(),
      status: "unverified",
      source: { kind: "unverified", note: "Outcome measurement is not known." },
      review: {
        claimType: "unverified",
        context: "uncertain",
        rationale: "No confirmed measurement available.",
      },
      optionalQuestion: "What outcome did this change have?",
    });
    expect(saved.optionalQuestion).toBe("What outcome did this change have?");
    await expect(
      service.resolve(userId, resumeId, [{ evidenceId: saved.id, revision: 1 }]),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects invented technologies and measurements in an evidence statement", async () => {
    const { service } = fixture();
    await expect(
      service.create(userId, resumeId, { ...input(), statement: "Built APIs using Kubernetes." }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create(userId, resumeId, {
        ...input(),
        statement: "Built 500 APIs using TypeScript.",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects stale base versions and changed scope entries", async () => {
    const { service, base } = fixture();
    const saved = await service.create(userId, resumeId, input());
    base.version = 4;
    await expect(
      service.resolve(userId, resumeId, [{ evidenceId: saved.id, revision: 1 }]),
    ).rejects.toMatchObject({ status: 409 });
    base.version = 3;
    base.content.experience[0].company = "Other employer";
    await expect(
      service.resolve(userId, resumeId, [{ evidenceId: saved.id, revision: 1 }]),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("revalidates mutable profile facts and excludes sensitive profile paths", async () => {
    const { service, user } = fixture();
    const request: CreateResumeEvidence = {
      ...input(),
      statement: "Toronto",
      scope: "general",
      source: { kind: "profile", field: "city", quote: "Toronto" },
    };
    const saved = await service.create(userId, resumeId, request);
    user.city = "Ottawa";
    await expect(
      service.resolve(userId, resumeId, [{ evidenceId: saved.id, revision: 1 }]),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      createResumeEvidenceSchema.safeParse({
        ...request,
        source: { kind: "profile", field: "passwordHash", quote: "secret" },
      }).success,
    ).toBe(false);
  });

  it("uses optimistic revisions for corrections and reversible retractions", async () => {
    const { service } = fixture();
    const saved = await service.create(userId, resumeId, input());
    const retracted = await service.retract(userId, resumeId, saved.id, 1);
    expect(retracted).toMatchObject({ status: "retracted", revision: 2 });
    await expect(
      service.resolve(userId, resumeId, [{ evidenceId: saved.id, revision: 1 }]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.correct(userId, resumeId, saved.id, { ...input(), expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    const restored = await service.correct(userId, resumeId, saved.id, {
      ...input(),
      expectedRevision: 2,
    });
    expect(restored).toMatchObject({ status: "supported", revision: 3 });
  });
});
