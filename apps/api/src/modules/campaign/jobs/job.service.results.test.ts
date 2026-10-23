import {
  ATTEMPT_CAMPAIGN,
  ATTEMPT_USER,
  ATTEMPT_VARIANT,
  attemptFixture,
  checkpointInput,
} from "@/modules/application/submission-attempt-fakes";
import { APPLIED_AT, setup } from "./fakes";
import { writeJobResult } from "./job-result";
import { describe, expect, it, spyOn } from "bun:test";

describe("receipt-backed application recording", () => {
  it("associates a confirmed submission with its existing Discover listing", async () => {
    const f = attemptFixture();
    const receipt = await f.confirm();
    const listing = spyOn(f.db.jobListing, "findFirst").mockResolvedValue({
      id: "discover-listing",
    } as never);
    try {
      const result = await writeJobResult(
        f.db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", checkpointId: receipt.checkpointId },
        f.files,
      );
      expect(result.application).toMatchObject({
        listingId: "discover-listing",
        listingKey: expect.any(String),
        listingUrl: expect.any(String),
      });
    } finally {
      listing.mockRestore();
    }
  });
  it("records retained PDF and receipt after the original base and variant are deleted", async () => {
    const f = attemptFixture();
    const input = { ...checkpointInput(), resumeVariantId: ATTEMPT_VARIANT };
    input.resume.artifact = {
      revision: "b".repeat(64),
      resumeId: input.resumeId,
      variantId: ATTEMPT_VARIANT,
    };
    const receipt = await f.confirm(input);
    const checkpoint = structuredClone(f.state.attempts[0].checkpoint);
    f.state.resumeDeleted = true;
    f.state.variantDeleted = true;
    const result = await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(result.application).toMatchObject({
      resumeId: null,
      resumeVariantId: null,
      submission: { resume: input.resume, confirmation: receipt.confirmation },
    });
    expect(f.state.attempts[0].checkpoint).toEqual(checkpoint);
    expect(f.state.attempts[0].checkpoint).toMatchObject({
      resumeId: input.resumeId,
      resumeVariantId: input.resumeVariantId,
    });
    expect(f.state.attempts[0].recordedAt).toBeInstanceOf(Date);
    expect(f.state.verificationCount).toBe(3);
  });

  it("keeps the owned base link when a variant is deleted or no longer belongs to that base", async () => {
    for (const variantState of ["deleted", "changed_base"]) {
      const f = attemptFixture();
      const input = { ...checkpointInput(), resumeVariantId: ATTEMPT_VARIANT };
      const receipt = await f.confirm(input);
      if (variantState === "deleted") f.state.variantDeleted = true;
      else f.state.variantResumeId = crypto.randomUUID();
      const result = await writeJobResult(
        f.db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", checkpointId: receipt.checkpointId },
        f.files,
      );
      expect(result.application).toMatchObject({ resumeId: input.resumeId, resumeVariantId: null });
      expect(f.state.attempts[0].checkpoint).toMatchObject({ resumeVariantId: ATTEMPT_VARIANT });
      expect(f.state.documentLinks).toHaveLength(1);
    }
  });

  it("links a still-owned variant only to its checkpoint's original base", async () => {
    const f = attemptFixture();
    const input = { ...checkpointInput(), resumeVariantId: ATTEMPT_VARIANT };
    const receipt = await f.confirm(input);
    const result = await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(result.application).toMatchObject({
      resumeId: input.resumeId,
      resumeVariantId: ATTEMPT_VARIANT,
    });
    expect(f.state.documentLinks[0]).toMatchObject({
      where: { id: ATTEMPT_VARIANT, resumeId: input.resumeId, resume: { userId: ATTEMPT_USER } },
    });
  });
  it("records only one application and event when result requests race", async () => {
    const f = attemptFixture();
    const receipt = await f.confirm();
    const command = { outcome: "applied" as const, checkpointId: receipt.checkpointId };
    const results = await Promise.all([
      writeJobResult(f.db, ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", command, f.files),
      writeJobResult(f.db, ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", command, f.files),
    ]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(f.state.applicationWrites).toBe(1);
    expect(results[0].application?.id).toBe(results[1].application?.id);
  });
  it("rejects fresh applied payloads without a begun, retained checkpoint receipt", async () => {
    const { db, files, state } = attemptFixture();
    await expect(
      writeJobResult(
        db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", appliedAt: APPLIED_AT },
        files,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.jobs[0].status).toBe("applying");
    expect(state.applicationWrites).toBe(0);
  });

  it("preserves historical applied replays without inventing new evidence", async () => {
    const state = setup();
    state.setStatus("applied");
    state.setApplication({ id: "historical", submission: null });
    const result = await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "applied",
      appliedAt: APPLIED_AT,
    });
    expect(result.application).toMatchObject({ id: "historical", submission: null });
    expect(state.applicationUpserts).toBe(0);
  });

  it("uses frozen job metadata, fields, PDF, ids and receipt time, then records idempotently", async () => {
    const f = attemptFixture();
    const receipt = await f.confirm();
    f.state.jobs[0].title = "Changed later";
    const result = await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(result.application).toMatchObject({
      title: "Engineer",
      appliedAt: new Date(receipt.confirmation.observedAt),
    });
    expect(result.application?.submission).toMatchObject({
      confirmation: receipt.confirmation,
      resume: { filename: "original.pdf" },
      fields: [{ id: "name", value: "Example Candidate" }],
    });
    expect(f.state.attempts[0].applicationId).toBe(result.application?.id ?? null);
    expect(f.state.attempts[0].recordedAt).toBeInstanceOf(Date);
    await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(f.state.applicationWrites).toBe(1);
  });

  it("retains the receipt when application creation fails, and recovery never begins again", async () => {
    const f = attemptFixture();
    const receipt = await f.confirm();
    f.state.failApplicationCreate = true;
    await expect(
      writeJobResult(
        f.db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", checkpointId: receipt.checkpointId },
        f.files,
      ),
    ).rejects.toThrow("persistence outage");
    expect(f.state.attempts[0].receipt).toEqual(receipt);
    expect(f.state.attempts[0].recordedAt).toBeNull();
    expect(f.state.jobs[0].status).toBe("applying");
    expect((await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", receipt.checkpointId)).began).toBe(
      false,
    );
    f.state.failApplicationCreate = false;
    await writeJobResult(
      f.db,
      ATTEMPT_USER,
      ATTEMPT_CAMPAIGN,
      "job",
      { outcome: "applied", checkpointId: receipt.checkpointId },
      f.files,
    );
    expect(f.state.applicationWrites).toBe(1);
  });

  it("blocks unknown outcomes from failed/skipped and rejects reconstructed overrides", async () => {
    const f = attemptFixture();
    const prepared = await f.prepare();
    await f.begin(ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", prepared.checkpointId!);
    for (const data of [
      { outcome: "failed" as const, failReason: "Timeout" },
      { outcome: "skipped" as const, skipReason: "Unknown" },
    ])
      await expect(
        writeJobResult(f.db, ATTEMPT_USER, ATTEMPT_CAMPAIGN, "job", data, f.files),
      ).rejects.toMatchObject({ status: 409 });
    await expect(
      writeJobResult(
        f.db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", checkpointId: prepared.checkpointId! },
        f.files,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("does not overwrite an existing Application if recording encounters a duplicate", async () => {
    const f = attemptFixture();
    const receipt = await f.confirm();
    f.state.applications.push({
      id: crypto.randomUUID(),
      userId: ATTEMPT_USER,
      url: f.state.jobs[0].url,
      title: "Historical",
    });
    await expect(
      writeJobResult(
        f.db,
        ATTEMPT_USER,
        ATTEMPT_CAMPAIGN,
        "job",
        { outcome: "applied", checkpointId: receipt.checkpointId },
        f.files,
      ),
    ).rejects.toThrow("Duplicate application");
    expect(f.state.attempts[0].receipt).toEqual(receipt);
    expect(f.state.attempts[0].recordedAt).toBeNull();
    expect(f.state.applications[0].title).toBe("Historical");
  });
});
