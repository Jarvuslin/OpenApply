import {
  intakePreparationFitSchema,
  intakePreparationPostingSchema,
  intakePreparationQuestionsSchema,
  intakePreparationSnapshotSchema,
} from "@openapply/contracts/intake-preparation";
import { resolveRequestAuth } from "@/common/middleware/auth-resolution";
import { DESCRIPTION } from "@/modules/scoring/fakes";
import { preparationFixture } from "./fakes";
import {
  preparationCredential,
  preparationSnapshot,
  storedPreparation,
  validatePreparation,
} from "./preparation.snapshot";
import { describe, expect, it } from "bun:test";

describe("exact preparation capability", () => {
  it("binds every scope field and rejects old or altered stored payloads", () => {
    const f = preparationFixture();
    expect(storedPreparation(f.item)).toEqual(f.snapshot);
    for (const field of ["intakeId", "jobId", "workItemId", "resumeId", "campaignId"] as const) {
      expect(() =>
        storedPreparation({ ...f.item, payload: { ...f.snapshot, [field]: crypto.randomUUID() } }),
      ).toThrow("scope");
    }
    expect(() =>
      storedPreparation({ ...f.item, payload: { intakeId: f.intake.id, jobIds: [f.job.id] } }),
    ).toThrow("unsupported");
    const { snapshotHash: _, ...scope } = f.snapshot;
    expect(preparationSnapshot(scope).snapshotHash).toBe(f.snapshot.snapshotHash);
    expect(intakePreparationSnapshotSchema.safeParse({ ...scope, injected: true }).success).toBe(
      false,
    );
  });

  it("refuses account credentials and never promotes prep credentials to ordinary auth", async () => {
    const f = preparationFixture();
    expect(preparationCredential(f.authorization)).toEqual({
      workItemId: f.item.id,
      leaseToken: f.item.leaseToken!,
    });
    for (const token of [
      undefined,
      "Bearer account-pat",
      "Bearer session.jwt.token",
      `${f.authorization}.extra`,
      `Bearer prep.${f.item.id}.bad`,
    ])
      expect(() => preparationCredential(token)).toThrow();
    let calls = 0;
    expect(
      await resolveRequestAuth(
        {
          headers: { authorization: f.authorization },
          cookie: { accessToken: { value: "valid-cookie" } },
        },
        {
          session: async () => {
            calls++;
            return null;
          },
          agent: async () => {
            calls++;
            return null;
          },
        },
      ),
    ).toBeNull();
    expect(calls).toBe(0);
  });

  it("permits only new unspent plans and the exact live lease", async () => {
    const f = preparationFixture();
    expect(
      (await validatePreparation(f.tx, f.scoring, f.userId, f.item, f.item.leaseToken!)).snapshot,
    ).toEqual(f.snapshot);
    await expect(f.service.plan(crypto.randomUUID(), f.item.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.service.plan(f.userId, f.item.id)).rejects.toThrow("unspent");
    f.item.state = "queued";
    f.item.attempts = 0;
    f.item.currentExecutionId = null;
    expect(await f.service.plan(f.userId, f.item.id)).toEqual(f.snapshot);
    expect(f.state.writes).toBe(0);
  });

  it("rejects each stopped, changed or wrong-scope capability before any posting mutation", async () => {
    const mutations = [
      (f: ReturnType<typeof preparationFixture>) => {
        f.item.leaseToken = crypto.randomUUID();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.item.leaseExpiresAt = new Date(0);
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.item.cancellationRequestedAt = new Date();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.item.pauseRequestedAt = new Date();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.item.state = "stopping";
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.execution.finishedAt = new Date();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.execution.releasedAt = new Date();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.intake.revision++;
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.intake.decision = "skip";
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.intake.jobId = crypto.randomUUID();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.intake.userId = crypto.randomUUID();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.intake.resolved = false;
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.job.url += "-different";
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.job.status = "approved";
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.job.campaign.status = "paused";
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.job.campaign.config.resumeId = crypto.randomUUID();
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.context.basis.sourceSha256 = "1".repeat(64);
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.context.basis.sourceTextSha256 = "2".repeat(64);
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.context.basis.preferencesSha256 = "3".repeat(64);
      },
      (f: ReturnType<typeof preparationFixture>) => {
        f.state.attempt = { startedAt: new Date() };
      },
    ];
    for (const mutate of mutations) {
      const f = preparationFixture();
      mutate(f);
      await expect(
        f.service.posting(f.authorization, { description: DESCRIPTION }),
      ).rejects.toThrow();
      expect(f.state.writes).toBe(0);
    }
  });

  it("derives posting target exclusively from the capability and rolls back on lease loss during source read", async () => {
    const f = preparationFixture();
    expect(
      await f.service.posting(f.authorization, {
        description: `${DESCRIPTION}\nAdditional posting details.`,
      }),
    ).toEqual({ ok: true });
    expect(f.job.description).toContain("Additional posting details.");
    expect(f.state.sourceReads).toBe(2);
    const g = preparationFixture();
    g.state.afterSource = () => {
      if (g.state.sourceReads === 1) g.item.leaseExpiresAt = new Date(0);
    };
    await expect(
      g.service.posting(g.authorization, { description: `${DESCRIPTION}\nShould roll back.` }),
    ).rejects.toThrow("lease");
    expect(g.job.description).toBe(DESCRIPTION);
    expect(g.state.writes).toBe(0);
  });

  it("narrow payloads reject target, status and human answer fields", () => {
    for (const field of [
      "jobId",
      "status",
      "url",
      "resumeId",
      "intakeId",
      "authorship",
      "confirmed",
    ])
      expect(
        intakePreparationPostingSchema.safeParse({ description: DESCRIPTION, [field]: "forged" })
          .success,
      ).toBe(false);
    expect(intakePreparationFitSchema.shape).not.toHaveProperty("jobId");
    expect(intakePreparationFitSchema.shape).not.toHaveProperty("resumeId");
    const input = {
      requestId: crypto.randomUUID(),
      expectedCollectionVersion: 0,
      source: "browser_dom",
      sourceUrl: "https://employer.test/job",
      coverage: "partial",
      collectorVersion: "test",
      definitions: [],
    };
    expect(intakePreparationQuestionsSchema.safeParse(input).success).toBe(true);
    expect(
      intakePreparationQuestionsSchema.safeParse({
        ...input,
        answers: [],
        authorship: "session_user",
      }).success,
    ).toBe(false);
  });
});
