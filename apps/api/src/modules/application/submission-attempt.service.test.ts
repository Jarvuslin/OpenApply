import { submissionWorkerResultSchema } from "@openapply/contracts/submission";
import { writeJobResult } from "@/modules/campaign/jobs/job-result";
import {
  ATTEMPT_CAMPAIGN,
  ATTEMPT_USER,
  ATTEMPT_VARIANT,
  attemptFixture,
  checkpointInput,
} from "./submission-attempt-fakes";
import { findSubmissionAttempt, submissionAttemptView } from "./submission-attempt-state";
import { describe, expect, it } from "bun:test";

describe("durable submission attempts", () => {
  it("pins the reviewed artifact and refuses an archived PDF with different bytes or IDs", async () => {
    const f = attemptFixture();
    const input = { ...checkpointInput(), resumeVariantId: ATTEMPT_VARIANT };
    input.resume.artifact = {
      revision: "b".repeat(64),
      resumeId: input.resumeId,
      variantId: ATTEMPT_VARIANT,
    };
    const prepared = await f.prepare(input);
    expect(prepared.checkpoint?.resume.artifact).toEqual(input.resume.artifact);
    expect(f.state.artifactReads).toEqual([
      [ATTEMPT_USER, input.resumeId, ATTEMPT_VARIANT, "b".repeat(64)],
    ]);
    f.state.artifactHash = "c".repeat(64);
    await expect(f.prepare(input)).rejects.toMatchObject({ status: 422 });
    input.resume.artifact.variantId = undefined;
    await expect(f.prepare(input)).rejects.toMatchObject({ status: 422 });
    input.resume.artifact.variantId = ATTEMPT_VARIANT;
    input.resume.artifact.resumeId = crypto.randomUUID();
    await expect(f.prepare(input)).rejects.toMatchObject({ status: 422 });
    expect(f.state.attempts).toHaveLength(1);
  });

  it("redacts sensitive fields and stores checked review, PDF and immutable original payload", async () => {
    const f = attemptFixture();
    const input = checkpointInput();
    input.fields.push({
      id: "password",
      label: "Password",
      type: "password",
      value: "must-not-persist",
    });
    const first = await f.prepare(input);
    const same = await f.prepare(input);
    expect(first.checkpointId).toBe(same.checkpointId);
    expect(first.checkpoint?.fields[1]).toMatchObject({ value: null, redacted: true });
    expect(JSON.stringify(f.state.attempts)).not.toContain("must-not-persist");
    expect(first.state).toBe("prepared");
    expect(first.startedAt).toBeNull();
    expect(f.state.verificationCount).toBe(2);
  });

  it("replaces only an expected prepared checkpoint and rejects stale begin or post-begin edits", async () => {
    const f = attemptFixture();
    const input = checkpointInput();
    const first = await f.prepare(input);
    input.fields[0].value = "Corrected Name";
    await expect(f.prepare(input)).rejects.toMatchObject({ status: 409 });
    const second = await f.prepare({ ...input, expectedCheckpointId: first.checkpointId! });
    expect(second.checkpointId).not.toBe(first.checkpointId);
    await expect(
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", first.checkpointId!),
    ).rejects.toMatchObject({ status: 409 });
    await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", second.checkpointId!);
    await expect(
      f.prepare({ ...input, expectedCheckpointId: second.checkpointId! }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("issues exactly one begin permission to concurrent workers, and a repeat is not permission", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    const results = await Promise.all([
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
    ]);
    expect(results.filter((result) => result.began)).toHaveLength(1);
    expect(results.every((result) => result.attempt.state === "unknown")).toBe(true);
    expect(
      (await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!)).began,
    ).toBe(false);
  });

  it("requires the owned original, a matching owned variant, complete review, and retained PDF", async () => {
    const f = attemptFixture();
    await expect(f.service.read("another-owner", ATTEMPT_CAMPAIGN, "job")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.prepare({ ...checkpointInput(), resumeId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.prepare({ ...checkpointInput(), resumeVariantId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    f.state.variantResumeId = crypto.randomUUID();
    await expect(
      f.prepare({ ...checkpointInput(), resumeVariantId: ATTEMPT_VARIANT }),
    ).rejects.toMatchObject({ status: 422 });
    const reviewInput = checkpointInput();
    reviewInput.review.issues = ["Wrong phone"];
    await expect(f.prepare(reviewInput)).rejects.toThrow();
    f.state.pdfValid = false;
    await expect(f.prepare()).rejects.toThrow("PDF mismatch");
    expect(f.state.attempts).toHaveLength(0);
  });

  it("blocks beginning if a job changed or was released after its review", async () => {
    for (const field of ["status", "updatedAt"]) {
      const f = attemptFixture();
      const p = await f.prepare();
      f.state.jobs[0][field] = field === "status" ? "approved" : new Date();
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", p.checkpointId!),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.attempts[0].startedAt).toBeNull();
    }
  });

  it("refuses new begin permissions after campaign pause, completion or failure without changing the job", async () => {
    for (const status of ["paused", "completed", "failed"]) {
      const f = attemptFixture();
      const prepared = await f.prepare();
      const priorJobTime = f.state.jobs[0].updatedAt;
      f.state.jobs[0].campaign = { userId: ATTEMPT_USER, source: "apply", status, config: {} };
      await expect(
        f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.state.jobs[0].updatedAt).toEqual(priorJobTime);
      expect(f.state.attempts[0].startedAt).toBeNull();
    }
  });

  it("still saves receipts and records existing begun work after the campaign stops", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!);
    f.state.jobs[0].campaign = {
      userId: ATTEMPT_USER,
      source: "apply",
      status: "completed",
      config: {},
    };
    const receipt = {
      checkpointId: prepared.checkpointId!,
      confirmation: {
        url: "https://ats.test/confirmed",
        text: "Application received",
        observedAt: new Date().toISOString(),
      },
    };
    expect(
      (await f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt)).attempt.state,
    ).toBe("recording_pending");
    const result = await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(result.application?.submission).toMatchObject({ confirmation: receipt.confirmation });
    expect((await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt.checkpointId)).began).toBe(
      false,
    );
  });

  it("stores a receipt once, rejects pre-begin, stale/future and different receipts", async () => {
    const f = attemptFixture();
    const p = await f.prepare();
    const receipt = {
      checkpointId: p.checkpointId!,
      confirmation: {
        url: "https://other-ats.test/success?token=secret",
        text: "Received",
        observedAt: new Date().toISOString(),
      },
    };
    await expect(
      f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt),
    ).rejects.toMatchObject({ status: 409 });
    await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", p.checkpointId!);
    for (const delta of [-600_000, 600_000])
      await expect(
        f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
          ...receipt,
          confirmation: {
            ...receipt.confirmation,
            observedAt: new Date(Date.now() + delta).toISOString(),
          },
        }),
      ).rejects.toMatchObject({ status: 422 });
    const first = await f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt);
    expect(first.attempt.state).toBe("recording_pending");
    expect(first.attempt.receipt?.confirmation.url).not.toContain("token");
    expect(
      (await f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt)).attempt
        .receiptStoredAt,
    ).toEqual(first.attempt.receiptStoredAt);
    await expect(
      f.service.receipt(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
        ...receipt,
        confirmation: { ...receipt.confirmation, text: "Different" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reserves the canonical posting across campaigns and preserves owner isolation", async () => {
    const f = attemptFixture();
    await f.prepare();
    const second = {
      ...f.state.jobs[0],
      id: crypto.randomUUID(),
      campaignId: crypto.randomUUID(),
      key: "second",
      url: `${f.state.jobs[0].url}?utm_source=elsewhere`,
    };
    f.state.jobs.push(second);
    await expect(
      f.service.checkpoint(ATTEMPT_USER, second.campaignId, "second", {
        ...checkpointInput(),
        resume: { ...checkpointInput().resume, jobId: second.id },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await findSubmissionAttempt(f.db, "different-owner", { url: String(second.url) }),
    ).toBeNull();
  });

  it("finds legacy reservations after the first page without inventing a checkpoint or begin", async () => {
    const f = attemptFixture();
    await f.prepare();
    const model = f.state.attempts[0];
    f.state.attempts = Array.from({ length: 101 }, (_, i) => ({
      ...model,
      id: `legacy-${String(i).padStart(3, "0")}`,
      jobId: null,
      canonicalUrl: null,
      checkpointId: null,
      checkpoint: null,
      checkpointHash: null,
      legacyOutcomeUnknown: true,
      originalUrl: `https://employer.test/jobs/${i}`,
    }));
    const found = await findSubmissionAttempt(f.db, ATTEMPT_USER, {
      url: "https://employer.test/jobs/100?utm_source=alias",
    });
    expect(found?.id).toBe("legacy-100");
    expect(submissionAttemptView(found!)).toMatchObject({
      state: "unknown",
      checkpoint: null,
      checkpointId: null,
      startedAt: null,
    });
  });

  it("retains legacy unknowns as unknown and does not synthesize a receipt/checkpoint", async () => {
    const f = attemptFixture();
    await f.prepare();
    Object.assign(f.state.attempts[0], {
      legacyOutcomeUnknown: true,
      checkpointId: null,
      checkpoint: null,
      checkpointHash: null,
      canonicalUrl: null,
    });
    await expect(f.prepare()).rejects.toMatchObject({ status: 409 });
    await expect(
      f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.service.read(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job")).attempt).toMatchObject({
      state: "unknown",
      startedAt: null,
    });
  });

  it("validates strict worker handbacks against persisted state rather than claiming success", async () => {
    const f = attemptFixture();
    const r = await f.confirm();
    expect(
      submissionWorkerResultSchema.safeParse({ outcome: "applied", submitted: true }).success,
    ).toBe(false);
    await expect(
      f.service.checkWorkerResult(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
        outcome: "recorded",
        checkpointId: r.checkpointId,
        applicationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await f.service.checkWorkerResult(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
          outcome: "recording_pending",
          checkpointId: r.checkpointId,
          context: "Retry only recording",
        })
      ).valid,
    ).toBe(true);
    const result = await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: r.checkpointId },
      f.files,
    );
    expect(
      (
        await f.service.checkWorkerResult(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", {
          outcome: "recorded",
          checkpointId: r.checkpointId,
          applicationId: result.application!.id,
        })
      ).valid,
    ).toBe(true);
  });
});
