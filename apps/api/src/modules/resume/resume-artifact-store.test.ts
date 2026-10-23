import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resumeDataSchema } from "@openapply/contracts/resume";
import { artifactRevision, ResumeArtifactStore, sha256 } from "./resume-artifact-store";
import { afterEach, describe, expect, test } from "bun:test";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openapply-artifact-"));
  if (
    path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith("openapply-artifact-")
  )
    throw new Error("Unexpected test cleanup directory");
  directories.push(root);
  const store = new ResumeArtifactStore(root);
  const target = { userId: crypto.randomUUID(), resumeId: crypto.randomUUID(), variantId: null };
  const content = resumeDataSchema.parse({ basics: { name: "Yuchen 林" } });
  const template = { id: "openapply-canonical", version: "1", sha256: sha256("template") };
  const input = {
    ...target,
    content,
    template,
    document: { jobUrl: null, diffNotes: null, audit: null },
    source: { version: 1, filename: null, sha256: null, content, contentSha256: sha256(content) },
    job: { url: null, description: "Engineer", sha256: sha256("Engineer") },
  };
  let calls = 0;
  const compile = async () => {
    calls++;
    return {
      pdf: Buffer.from("%PDF-immutable artifact"),
      tex: "Resume — 林",
      template,
      compiler: { name: "tectonic", version: "0.test" },
      validation: {
        valid: true as const,
        pageCount: 1 as const,
        pageSize: { width: 612 as const, height: 792 as const },
        fontFamilies: ["CMR10"],
        textVerified: true as const,
        boundsVerified: true as const,
        warnings: [],
      },
    };
  };
  return { root, store, target, input, compile, calls: () => calls };
}

describe("immutable resume artifacts", () => {
  test("reuses persisted exact bytes without invoking compiler on a hit", async () => {
    const f = await fixture();
    const first = await f.store.create(f.input, f.compile);
    const second = await f.store.create(f.input, async () => {
      throw new Error("must not render");
    });
    expect(second).toEqual(first);
    expect(f.calls()).toBe(1);
    expect(await f.store.file(f.target, first.revision, "tex")).toEqual(Buffer.from("Resume — 林"));
    expect(first.pdfSha256).toBe(sha256(await f.store.file(f.target, first.revision, "pdf")));
  });

  test("content/template revisions preserve previous files and provenance", async () => {
    const f = await fixture();
    const old = await f.store.create(f.input, f.compile);
    const changed = { ...f.input, content: { ...f.input.content, summary: "New summary" } };
    const next = await f.store.create(changed, f.compile);
    expect(next.revision).not.toBe(old.revision);
    expect(
      artifactRevision({ ...f.input, template: { ...f.input.template, sha256: sha256("v2") } }),
    ).not.toBe(old.revision);
    expect((await f.store.get(f.target, old.revision)).content.summary).toBeUndefined();
    expect((await f.store.get(f.target, old.revision)).job.description).toBe("Engineer");
  });

  test("failed compilation leaves no current artifact; no fallback is substituted", async () => {
    const f = await fixture();
    await expect(
      f.store.create(f.input, async () => {
        throw new Error("2 pages");
      }),
    ).rejects.toThrow("2 pages");
    expect(await f.store.current(f.input)).toBeNull();
  });

  test("same wording and URL with changed source or JD produces distinct immutable provenance", async () => {
    const f = await fixture();
    const original = await f.store.create(f.input, f.compile);
    const newJob = {
      ...f.input,
      job: { ...f.input.job, description: "Backend engineer", sha256: sha256("Backend engineer") },
    };
    const changedJob = await f.store.create(newJob, f.compile);
    const changedSource = await f.store.create(
      { ...newJob, source: { ...newJob.source, version: 2 } },
      f.compile,
    );
    expect(new Set([original.revision, changedJob.revision, changedSource.revision]).size).toBe(3);
    expect((await f.store.current(f.input))?.revision).toBe(changedSource.revision);
    expect((await f.store.get(f.target, original.revision)).job.description).toBe("Engineer");
    expect((await f.store.get(f.target, changedJob.revision)).source.version).toBe(1);
  });

  test("corrupt persisted bytes fail instead of regenerating or claiming verified", async () => {
    const f = await fixture();
    const artifact = await f.store.create(f.input, f.compile);
    const pdf = path.join(
      f.root,
      f.target.userId,
      f.target.resumeId,
      "base",
      artifact.revision,
      "resume.pdf",
    );
    await writeFile(pdf, "%PDF-tampered");
    await expect(f.store.create(f.input, f.compile)).rejects.toThrow("integrity");
    expect(f.calls()).toBe(1);
  });

  test("owner and document scope cannot read another artifact, nor traverse paths", async () => {
    const f = await fixture();
    const artifact = await f.store.create(f.input, f.compile);
    await expect(
      f.store.get({ ...f.target, userId: crypto.randomUUID() }, artifact.revision),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(f.store.get(f.target, "../manifest.json")).rejects.toThrow("Invalid artifact");
  });

  test("a missing file in a committed revision cannot be silently regenerated", async () => {
    const f = await fixture();
    const artifact = await f.store.create(f.input, f.compile);
    await rm(
      path.join(
        f.root,
        f.target.userId,
        f.target.resumeId,
        "base",
        artifact.revision,
        "resume.pdf",
      ),
    );
    await expect(f.store.create(f.input, f.compile)).rejects.toThrow("integrity");
    await expect(f.store.current(f.input)).rejects.toThrow("integrity");
    expect(f.calls()).toBe(1);
  });

  test("concurrent generation publishes one complete bundle and returns the winner bytes", async () => {
    const f = await fixture();
    let count = 0;
    const compile = async () => ({
      ...(await f.compile()),
      pdf: Buffer.from(`%PDF-run-${++count}`),
    });
    const results = await Promise.all([
      f.store.create(f.input, compile),
      f.store.create(f.input, compile),
    ]);
    expect(results[0]).toEqual(results[1]);
    const bytes = await f.store.file(f.target, results[0]!.revision, "pdf");
    expect(sha256(bytes)).toBe(results[0]!.pdfSha256);
    expect(
      await readFile(
        path.join(
          f.root,
          f.target.userId,
          f.target.resumeId,
          "base",
          results[0]!.revision,
          "source.tex",
        ),
        "utf8",
      ),
    ).toBe("Resume — 林");
  });

  test("explicit deletion removes only the owned document's artifacts", async () => {
    const f = await fixture();
    const baseArtifact = await f.store.create(f.input, f.compile);
    const variant = { ...f.input, variantId: crypto.randomUUID() };
    const variantArtifact = await f.store.create(variant, f.compile);
    const other = { ...f.input, userId: crypto.randomUUID() };
    const otherArtifact = await f.store.create(other, f.compile);
    await f.store.remove(variant);
    await expect(f.store.get(variant, variantArtifact.revision)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await f.store.get(f.target, baseArtifact.revision)).revision).toBe(
      baseArtifact.revision,
    );
    await f.store.remove(f.target);
    await expect(f.store.get(f.target, baseArtifact.revision)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await f.store.get(other, otherArtifact.revision)).revision).toBe(
      otherArtifact.revision,
    );
    await expect(f.store.remove({ ...f.target, resumeId: "../escape" })).rejects.toThrow();
  });
});
