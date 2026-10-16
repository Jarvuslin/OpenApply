import { readFile } from "node:fs/promises";
import path from "node:path";
import { singleton } from "tsyringe";
import { findOwned, notFound, unprocessable } from "@/common/errors";
import { RESUME_TEMPLATE } from "@/common/pdf/canonical-template";
import { renderResumeArtifact } from "@/common/pdf/render";
import { resumePath, slugifyForDownload } from "@/common/storage/storage";
import { env } from "@/env";
import { PrismaClient, type Resume, type ResumeVariant } from "@/generated/prisma/client";
import { readContent } from "./content";
import type { ResumeArtifact } from "./resume-artifact.schema";
import { ResumeArtifactStore, sha256 } from "./resume-artifact-store";

type ArtifactDraft = Pick<ResumeVariant, "id" | "content" | "jobUrl" | "diffNotes" | "rewrites">;

@singleton()
export class ResumeArtifactService {
  private readonly store = new ResumeArtifactStore(
    path.resolve(env.STORAGE_ROOT, "resume-artifacts"),
  );

  constructor(private readonly prisma: PrismaClient) {}

  async variantResumeId(userId: string, variantId: string) {
    const variant = await findOwned(
      (where) => this.prisma.resumeVariant.findFirst({ where, select: { resumeId: true } }),
      { id: variantId, resume: { userId } },
      "Variant",
    );
    return variant.resumeId;
  }

  private async document(userId: string, resumeId: string, variantId?: string) {
    const base = await findOwned(
      (where) => this.prisma.resume.findFirst({ where }),
      { id: resumeId, userId },
      "Resume",
    );
    const variant = variantId
      ? await findOwned(
          (where) => this.prisma.resumeVariant.findFirst({ where }),
          { id: variantId, resumeId, resume: { userId } },
          "Variant",
        )
      : null;
    const raw = variant ? variant.content : base.content;
    return { base, variant, content: raw === null ? null : readContent(raw) };
  }

  private key(
    userId: string,
    document: {
      base: Resume;
      variant: ArtifactDraft | null;
      content: ReturnType<typeof readContent> | null;
    },
  ) {
    const { base, variant, content } = document;
    if (!content) throw unprocessable("Save extracted resume content before generating a PDF.");
    return {
      userId,
      resumeId: base.id,
      variantId: variant?.id ?? null,
      content,
      template: RESUME_TEMPLATE,
      document: {
        jobUrl: variant?.jobUrl ?? null,
        diffNotes: variant?.diffNotes ?? null,
        audit: (variant?.rewrites ?? null) as ResumeArtifact["audit"],
      },
    };
  }

  async current(userId: string, resumeId: string, variantId?: string) {
    const document = await this.document(userId, resumeId, variantId);
    if (!document.content) return { artifact: null };
    try {
      return { artifact: await this.store.current(this.key(userId, document)) };
    } catch (error) {
      throw unprocessable(
        error instanceof Error ? error.message : "Cannot verify saved resume artifact.",
      );
    }
  }

  async create(userId: string, resumeId: string, variantId?: string, jobDescription?: string) {
    const document = await this.document(userId, resumeId, variantId);
    if (variantId && jobDescription === undefined) {
      const existing = await this.store.current(this.key(userId, document));
      if (existing) return existing;
    }
    return this.createDocument(userId, document, jobDescription);
  }

  /** Called only after the owning row's authorized deletion; submission archives are separate. */
  removeFiles(userId: string, resumeId: string, variantId?: string) {
    return this.store.remove({ userId, resumeId, variantId: variantId ?? null });
  }

  /** Compile before publishing a new variant row. The caller passes the exact owned base it tailored. */
  async prepareVariant(
    userId: string,
    base: Resume,
    draft: ArtifactDraft,
    jobDescription?: string,
  ) {
    if (base.userId !== userId) throw notFound("Resume");
    return this.createDocument(
      userId,
      {
        base,
        variant: draft,
        content: readContent(draft.content),
      },
      jobDescription,
    );
  }

  private async createDocument(
    userId: string,
    document: {
      base: Resume;
      variant: ArtifactDraft | null;
      content: ReturnType<typeof readContent> | null;
    },
    jobDescription?: string,
  ) {
    const key = this.key(userId, document);
    try {
      const { base, variant } = document;
      const sourceContent = base.content === null ? null : readContent(base.content);
      return await this.store.create(
        {
          ...key,
          source: {
            version: base.version,
            filename: base.sourceFilename,
            sha256: base.sourceFilename
              ? sha256(await readFile(resumePath(base.sourceFilename)))
              : null,
            content: sourceContent,
            contentSha256: sourceContent ? sha256(sourceContent) : null,
          },
          job: {
            url: variant?.jobUrl ?? null,
            description: jobDescription ?? null,
            sha256: jobDescription ? sha256(jobDescription) : null,
          },
        },
        () => renderResumeArtifact(key.content),
      );
    } catch (error) {
      throw unprocessable(
        `Resume PDF generation failed: ${error instanceof Error ? error.message : "unknown compiler failure"}. The saved resume content is unchanged.`,
      );
    }
  }

  async get(userId: string, resumeId: string, variantId: string | undefined, revision: string) {
    await this.document(userId, resumeId, variantId);
    try {
      return await this.store.get({ userId, resumeId, variantId: variantId ?? null }, revision);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw notFound("Resume artifact missing on disk");
      throw unprocessable(
        error instanceof Error ? error.message : "Cannot verify saved resume artifact.",
      );
    }
  }

  async file(
    userId: string,
    resumeId: string,
    variantId: string | undefined,
    revision: string,
    format: "pdf" | "tex",
  ) {
    const document = await this.document(userId, resumeId, variantId);
    const artifact = await this.get(userId, resumeId, variantId, revision);
    const bytes = await this.store.file(
      { userId, resumeId, variantId: variantId ?? null },
      revision,
      format,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": format === "pdf" ? "application/pdf" : "application/x-tex; charset=utf-8",
        "content-length": String(bytes.length),
        "content-disposition": `${format === "pdf" ? "inline" : "attachment"}; filename="${slugifyForDownload(document.variant?.label ?? document.base.label)}-${revision.slice(0, 12)}.${format}"`,
        "cache-control": "private, no-cache",
        "x-resume-artifact-revision": artifact.revision,
        "x-content-sha256": format === "pdf" ? artifact.pdfSha256 : artifact.texSha256,
      },
    });
  }

  async currentPdf(userId: string, resumeId: string, variantId?: string) {
    const { artifact } = await this.current(userId, resumeId, variantId);
    if (!artifact)
      throw unprocessable(
        "This saved content has no canonical PDF revision. Generate its PDF explicitly before previewing or submitting it.",
      );
    return this.file(userId, resumeId, variantId, artifact.revision, "pdf");
  }
}
