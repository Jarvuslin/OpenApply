import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResumeData } from "@openapply/contracts/resume";
import { z } from "zod/v4";
import { sha256 as hashBytes } from "@/common/crypto/hash";
import { type ResumeArtifact, resumeArtifactSchema } from "./resume-artifact.schema";

interface ArtifactTarget {
  userId: string;
  resumeId: string;
  variantId: string | null;
}

interface ArtifactKey extends ArtifactTarget {
  content: ResumeData;
  template: ResumeArtifact["template"];
  document: { jobUrl: string | null; diffNotes: string | null; audit: ResumeArtifact["audit"] };
}

interface ArtifactInput extends ArtifactKey {
  source: ResumeArtifact["source"];
  job: ResumeArtifact["job"];
}

type CompiledArtifact = Pick<ResumeArtifact, "template" | "compiler" | "validation"> & {
  pdf: Buffer;
  tex: string;
};

/** Object key ordering never creates a second revision of the same content. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, current) =>
    current && typeof current === "object" && !Array.isArray(current)
      ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)))
      : current,
  );
}

export function sha256(value: unknown): string {
  return hashBytes(Buffer.isBuffer(value) || typeof value === "string" ? value : canonical(value));
}

function lookupKey(input: ArtifactKey): string {
  return sha256({ content: input.content, template: input.template, document: input.document });
}

export function artifactRevision(input: ArtifactInput): string {
  return sha256({ lookup: lookupKey(input), source: input.source, job: input.job });
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Durable bundles, deliberately outside the regenerable/evictable PDF cache. */
export class ResumeArtifactStore {
  constructor(private readonly root: string) {}

  async remove(target: ArtifactTarget) {
    const documentDirectory = path.dirname(this.directory(target, "0".repeat(64)));
    const directory = target.variantId ? documentDirectory : path.dirname(documentDirectory);
    if (!path.resolve(directory).startsWith(`${path.resolve(this.root)}${path.sep}`))
      throw new Error("Invalid artifact cleanup path");
    await rm(directory, { recursive: true, force: true });
  }

  private directory(target: ArtifactTarget, revision: string): string {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid artifact revision");
    z.uuid().parse(target.userId);
    z.uuid().parse(target.resumeId);
    if (target.variantId) z.uuid().parse(target.variantId);
    return path.join(
      this.root,
      target.userId,
      target.resumeId,
      target.variantId ?? "base",
      revision,
    );
  }

  async get(target: ArtifactTarget, revision: string): Promise<ResumeArtifact> {
    const directory = this.directory(target, revision);
    const [raw, pdf, tex] = await Promise.all([
      readFile(path.join(directory, "manifest.json"), "utf8"),
      readFile(path.join(directory, "resume.pdf")),
      readFile(path.join(directory, "source.tex")),
    ]);
    const parsed = JSON.parse(raw);
    const artifact = resumeArtifactSchema.parse({
      ...parsed,
      createdAt: new Date(parsed.createdAt),
    });
    if (
      artifact.revision !== revision ||
      artifact.resumeId !== target.resumeId ||
      artifact.variantId !== target.variantId ||
      artifact.pdfSha256 !== sha256(pdf) ||
      artifact.texSha256 !== sha256(tex) ||
      artifact.contentSha256 !== sha256(artifact.content) ||
      artifact.sizeBytes !== pdf.length ||
      revision !==
        artifactRevision({
          ...target,
          content: artifact.content,
          template: artifact.template,
          document: {
            jobUrl: artifact.job.url,
            diffNotes: artifact.diffNotes,
            audit: artifact.audit,
          },
          source: artifact.source,
          job: artifact.job,
        })
    )
      throw new Error(
        "Resume artifact integrity check failed. The stored revision cannot be used.",
      );
    return artifact;
  }

  async current(input: ArtifactKey): Promise<ResumeArtifact | null> {
    const pointer = path.join(
      path.dirname(this.directory(input, lookupKey(input))),
      `current-${lookupKey(input)}.json`,
    );
    let revision: string;
    try {
      revision = JSON.parse(await readFile(pointer, "utf8")).revision;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    try {
      const artifact = await this.get(input, revision);
      if (
        lookupKey(input) !==
        lookupKey({
          ...input,
          content: artifact.content,
          template: artifact.template,
          document: {
            jobUrl: artifact.job.url,
            diffNotes: artifact.diffNotes,
            audit: artifact.audit,
          },
        })
      )
        throw new Error(
          "Resume artifact integrity check failed: current revision points at different content.",
        );
      return artifact;
    } catch (error) {
      if (missing(error))
        throw new Error("Resume artifact integrity check failed: a saved revision is missing.");
      throw error;
    }
  }

  private async selectCurrent(input: ArtifactInput, revision: string) {
    const pointer = path.join(
      path.dirname(this.directory(input, revision)),
      `current-${lookupKey(input)}.json`,
    );
    const temporary = `${pointer}.pending-${randomUUID()}`;
    try {
      await writeFile(temporary, JSON.stringify({ revision }), { flag: "wx" });
      try {
        await rename(temporary, pointer);
      } catch (error) {
        // Windows can reject replacement while the competing winner reads its index.
        // Identical selection is already complete; a different selection must still fail visibly.
        const selected = JSON.parse(await readFile(pointer, "utf8"));
        if (selected.revision !== revision) throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async file(target: ArtifactTarget, revision: string, format: "pdf" | "tex"): Promise<Buffer> {
    const artifact = await this.get(target, revision);
    const bytes = await readFile(
      path.join(this.directory(target, revision), format === "pdf" ? "resume.pdf" : "source.tex"),
    );
    if (sha256(bytes) !== (format === "pdf" ? artifact.pdfSha256 : artifact.texSha256))
      throw new Error("Resume artifact integrity check failed during download.");
    return bytes;
  }

  async create(
    input: ArtifactInput,
    compile: () => Promise<CompiledArtifact>,
  ): Promise<ResumeArtifact> {
    const revision = artifactRevision(input);
    try {
      const existing = await this.get(input, revision);
      await this.selectCurrent(input, revision);
      return existing;
    } catch (error) {
      if (!missing(error)) throw error;
      // A committed partial bundle is corrupt, not a cache miss to repair with new bytes.
      let committed = false;
      try {
        await readFile(path.join(this.directory(input, revision), "manifest.json"));
        committed = true;
      } catch (manifestError) {
        if (!missing(manifestError)) throw manifestError;
      }
      if (committed)
        throw new Error("Resume artifact integrity check failed: a stored file is missing.");
      await this.current(input);
    }
    const compiled = await compile();
    if (canonical(compiled.template) !== canonical(input.template))
      throw new Error("Resume template changed during compilation. Generate a fresh revision.");
    const prefix = input.variantId
      ? `/api/resumes/variants/${input.variantId}`
      : `/api/resumes/${input.resumeId}`;
    const metadataUrl = `${prefix}/artifacts/${revision}`;
    const artifact = resumeArtifactSchema.parse({
      revision,
      resumeId: input.resumeId,
      variantId: input.variantId,
      createdAt: new Date(),
      content: input.content,
      contentSha256: sha256(input.content),
      pdfSha256: sha256(compiled.pdf),
      texSha256: sha256(compiled.tex),
      sizeBytes: compiled.pdf.length,
      template: compiled.template,
      compiler: compiled.compiler,
      validation: compiled.validation,
      source: input.source,
      job: input.job,
      audit: input.document.audit,
      diffNotes: input.document.diffNotes,
      metadataUrl,
      pdfUrl: `${metadataUrl}/pdf`,
      texUrl: `${metadataUrl}/tex`,
    });
    const destination = this.directory(input, revision);
    const temporary = `${destination}.pending-${randomUUID()}`;
    // Resolve the recursive-cleanup target before creating it, under this store's exact root.
    if (!path.resolve(temporary).startsWith(`${path.resolve(this.root)}${path.sep}`))
      throw new Error("Invalid artifact temporary path");
    await mkdir(temporary, { recursive: true });
    try {
      await Promise.all([
        writeFile(path.join(temporary, "resume.pdf"), compiled.pdf, { flag: "wx" }),
        writeFile(path.join(temporary, "source.tex"), compiled.tex, { flag: "wx" }),
        writeFile(path.join(temporary, "manifest.json"), JSON.stringify(artifact), { flag: "wx" }),
      ]);
      try {
        await rename(temporary, destination);
      } catch (error) {
        // Another request may have won the atomic publish. Read its exact bytes, never overwrite.
        try {
          await this.get(input, revision);
        } catch {
          throw error;
        }
      }
      const saved = await this.get(input, revision);
      await this.selectCurrent(input, revision);
      return saved;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
