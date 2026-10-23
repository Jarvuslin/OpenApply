import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { subscribe } from "@/common/sse/server";
import type { ResumeEvidenceService } from "@/modules/resume/evidence/resume-evidence.service";
import { ResumeService } from "@/modules/resume/resume.service";
import { ResumeVariantService } from "@/modules/resume/variants/variant.service";
import { preparationFixture } from "./preparation-fakes";
import { describe, expect, it } from "bun:test";

async function selectedFixture() {
  const f = await preparationFixture();
  const selected = await f.preparation.selectDocument(
    f.userId,
    f.snapshot.questions[0].id,
    f.select(),
    "session_user",
  );
  const resumes = new ResumeService(f.db, f.artifacts);
  Object.assign(f.artifacts, { removeFiles: async () => {} });
  Object.assign(f.resume, { variants: [] });
  const variants = new ResumeVariantService(
    f.db,
    resumes,
    f.artifacts,
    {} as ResumeEvidenceService,
  );
  return { ...f, selected, resumesService: resumes, variantsService: variants };
}

describe("document source changes restore attention immediately", () => {
  it("content edits atomically restore the blocker and publish owned Needs-you and Queue events", async () => {
    const f = await selectedFixture();
    const attention = subscribe(needsYouChannel, { userId: f.userId });
    const queue = subscribe(workQueueChannel, { userId: f.userId });
    await attention.next();
    await queue.next();
    const before = structuredClone(f.documentSelections[0]);
    try {
      await f.resumesService.update(f.userId, f.resume.id, {
        content: { ...f.resume.content, summary: "Corrected by user" },
      });
      expect(f.applicationQuestions[0].blocking).toBe(true);
      expect(f.workItems[0].state).toBe("needs_user");
      expect(f.documentSelections[0]).toEqual(before);
      expect((await attention.next()).value).toMatchObject({
        data: { type: "needs-you.changed", jobId: f.job.id },
      });
      expect((await queue.next()).value).toMatchObject({ data: { type: "work-queue.changed" } });
      expect(
        (await f.preparation.get(f.userId, f.job.id)).documentFields[0].selection?.available,
      ).toBe(false);
    } finally {
      await attention.return();
      await queue.return();
    }
  });
  it("does not invalidate a base label edit or another user's selection", async () => {
    const f = await selectedFixture();
    const updatedAt = f.job.updatedAt.getTime();
    await f.resumesService.update(f.userId, f.resume.id, { label: "Renamed original" });
    expect(f.applicationQuestions[0].blocking).toBe(false);
    expect(f.workItems[0].state).toBe("queued");
    expect(f.job.updatedAt.getTime()).toBe(updatedAt);
    await expect(
      f.resumesService.update(crypto.randomUUID(), f.resume.id, { content: f.resume.content }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.applicationQuestions[0].blocking).toBe(false);
  });
  it("preserves live lease pause stop and ambiguous submission evidence while updating attention", async () => {
    for (const state of ["preparing", "paused", "stopping", "needs_user"] as const) {
      const f = await selectedFixture();
      const lease = crypto.randomUUID();
      Object.assign(f.workItems[0], {
        state,
        leaseToken: lease,
        leaseExpiresAt: new Date(Date.now() + 60000),
        pauseRequestedAt: state === "paused" ? new Date() : null,
        cancellationRequestedAt: state === "stopping" ? new Date() : null,
      });
      const attempt = {
        id: crypto.randomUUID(),
        userId: f.userId,
        jobId: f.job.id,
        canonicalUrl: f.job.url,
        startedAt: new Date(),
        receiptStoredAt: null,
      };
      f.submissions.push(attempt);
      const before = structuredClone(f.workItems[0]);
      await f.resumesService.update(f.userId, f.resume.id, {
        content: { ...f.resume.content, summary: "Source changed" },
      });
      expect(f.applicationQuestions[0].blocking).toBe(true);
      expect(f.workItems[0]).toEqual(before);
      expect(f.submissions[0]).toEqual(attempt);
    }
  });
  it("source removal restores blockers before source-file cleanup", async () => {
    const f = await selectedFixture();
    const row = f.documentSelections[0];
    Object.assign(f.resume, { sourceFilename: null });
    row.sourceSnapshot = {
      ...(row.sourceSnapshot as object),
      sourceFilename: "previous-original.pdf",
    };
    await f.resumesService.deleteSource(f.userId, f.resume.id);
    expect(f.applicationQuestions[0].blocking).toBe(true);
    expect(f.workItems[0].state).toBe("needs_user");
  });
  it("master deletion retains selection history and restores the current question", async () => {
    const f = await selectedFixture();
    await f.resumesService.remove(f.userId, f.resume.id);
    expect(f.resumes).toHaveLength(0);
    expect(f.documentSelections).toHaveLength(1);
    expect(f.applicationQuestions[0].blocking).toBe(true);
    expect(f.workItems[0].state).toBe("needs_user");
  });
  for (const action of ["edit", "delete", "apply", "prune"] as const)
    it(`variant ${action} restores its selected field without erasing history`, async () => {
      const f = await selectedFixture();
      const id = crypto.randomUUID();
      const variant = {
        id,
        resumeId: f.resume.id,
        resume: { userId: f.userId },
        content: f.resume.content,
        jobUrl: f.job.url,
        label: "Variant",
        applicationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      f.variants.push(variant);
      f.documentSelections[0].variantId = id;
      const snapshot = f.documentSelections[0].sourceSnapshot as Record<string, unknown>;
      snapshot.variantContentSha256 = f.artifact.contentSha256;
      snapshot.variantUpdatedAt = variant.updatedAt.toISOString();
      if (action === "edit")
        await f.variantsService.updateVariant(f.userId, id, {
          content: { ...f.resume.content, summary: "Variant correction" },
        });
      if (action === "delete") await f.variantsService.removeVariant(f.userId, id);
      if (action === "apply") await f.variantsService.applyVariant(f.userId, id);
      if (action === "prune")
        await f.variantsService.pruneVariants(f.userId, f.resume.id, {
          keep: 0,
          unlinkedOnly: true,
        });
      expect(f.applicationQuestions[0].blocking).toBe(true);
      expect(f.workItems[0].state).toBe("needs_user");
      expect(f.documentSelections).toHaveLength(1);
    });
});
