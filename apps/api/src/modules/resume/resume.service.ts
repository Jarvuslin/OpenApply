import path from "node:path";
import { resumeChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { badRequest, conflict, findOwned, notFound } from "@/common/errors";
import { publish } from "@/common/sse";
import {
  deleteResumeFile,
  resumePath,
  saveResumeSource,
  streamFile,
} from "@/common/storage/storage";
import { PrismaClient, type Resume } from "@/generated/prisma/client";
import {
  invalidateDocumentSelections,
  publishDocumentInvalidation,
} from "@/modules/application-question/document.invalidation";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { findProfileMismatches } from "./consistency";
import { readContent, toStoredContent } from "./content";
import { extractSourceText } from "./extract-source";
import type { createResumeSchema, updateResumeSchema } from "./resume.schema";
import { ResumeArtifactService } from "./resume-artifact.service";
import { sourceReplacementWhere } from "./source-replacement";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

type CreateResumeInput = z.infer<typeof createResumeSchema>;
type UpdateResumeInput = z.infer<typeof updateResumeSchema>;

interface SavedSource {
  sourceFilename: string;
  sourceMimeType: string;
  sourceSizeBytes: number;
}

@singleton()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: ResumeArtifactService,
  ) {}

  async sourceText(userId: string, id: string) {
    const resume = await this.findOwned(userId, id);
    if (!resume.sourceFilename) throw badRequest("Upload a resume first.");
    let text: string;
    try {
      text = await extractSourceText(resumePath(resume.sourceFilename));
    } catch {
      throw badRequest("Could not read this document. Use a text-based PDF, DOCX or TXT resume.");
    }
    if (text.trim().length < 40)
      throw badRequest(
        "No readable text found. Use a text-based PDF, DOCX or TXT file; scanned documents need OCR.",
      );
    return { text };
  }

  /** Unpaginated: an account holds a handful of master resumes, and selects read the whole list. */
  async list(userId: string) {
    const [profile, resumes] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { primaryResumeId: true } }),
      this.prisma.resume.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { variants: true } } },
      }),
    ]);

    return resumes
      .map((r) => ({
        id: r.id,
        label: r.label,
        sourceFilename: r.sourceFilename,
        hasData: r.content !== null,
        variantCount: r._count.variants,
        isPrimary: r.id === profile?.primaryResumeId,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }

  async createJson(userId: string, input: CreateResumeInput) {
    const resume = await this.prisma.resume.create({
      data: {
        userId,
        label: input.label,
        content: input.content && toStoredContent(input.content),
      },
    });
    await this.claimPrimaryIfUnset(userId, resume.id);
    return { id: resume.id };
  }

  async createFromUpload(userId: string, file: File, label?: string) {
    const resume = await this.withSavedSource(file, (source) =>
      this.prisma.resume.create({
        data: {
          userId,
          label: label?.trim() || path.basename(file.name, path.extname(file.name)) || "Resume",
          ...source,
        },
      }),
    );
    await this.claimPrimaryIfUnset(userId, resume.id);
    return { id: resume.id };
  }

  async get(userId: string, id: string) {
    const [profile, resume] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          primaryResumeId: true,
          city: true,
          state: true,
          contactEmail: true,
          phone: true,
          linkedin: true,
          github: true,
          website: true,
        },
      }),
      this.findOwned(userId, id),
    ]);
    const content = resume.content === null ? null : readContent(resume.content);

    return {
      id: resume.id,
      userId: resume.userId,
      label: resume.label,
      content,
      version: resume.version,
      sourceFilename: resume.sourceFilename,
      sourceMimeType: resume.sourceMimeType,
      sourceSizeBytes: resume.sourceSizeBytes,
      isPrimary: profile?.primaryResumeId === resume.id,
      // Served here rather than behind its own route: every reader of the contact block needs it.
      profileMismatches: profile ? findProfileMismatches(content?.basics, profile) : [],
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt,
    };
  }

  async update(userId: string, id: string, body: UpdateResumeInput) {
    if (body.label === undefined && body.content === undefined) {
      throw badRequest("label or content required");
    }
    const { updated, affected } = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await findOwned((where) => tx.resume.findFirst({ where }), { id, userId }, "Resume");
      const updated = await tx.resume.update({
        where: { id },
        data: {
          label: body.label,
          ...(body.content
            ? { content: toStoredContent(body.content), version: { increment: 1 } }
            : {}),
        },
      });
      const affected = body.content ? await invalidateDocumentSelections(tx, userId, id) : [];
      return { updated, affected };
    });
    publishDocumentInvalidation(userId, affected);

    if (body.content) {
      publish(
        resumeChannel,
        { resumeId: id },
        { type: "content.updated", resumeId: id, version: updated.version },
      );
    }
    return { id, version: updated.version };
  }

  async remove(userId: string, id: string) {
    const { resume, affected } = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const resume = await findOwned(
        (where) =>
          tx.resume.findFirst({
            where,
            select: { sourceFilename: true },
          }),
        { id, userId },
        "Resume",
      );
      await tx.resume.delete({ where: { id } });
      return { resume, affected: await invalidateDocumentSelections(tx, userId, id) };
    });
    publishDocumentInvalidation(userId, affected);
    if (resume.sourceFilename) await deleteResumeFile(resume.sourceFilename);
    await this.artifacts.removeFiles(userId, id);

    return { deleted: id };
  }

  findOwned(userId: string, id: string): Promise<Resume> {
    return findOwned((where) => this.prisma.resume.findFirst({ where }), { id, userId }, "Resume");
  }

  async renderPdf(userId: string, id: string) {
    const resume = await this.findOwned(userId, id);
    if (resume.content !== null) return this.artifacts.currentPdf(userId, id);
    return this.streamSource(resume);
  }

  async getSource(userId: string, id: string) {
    return this.streamSource(await this.findOwned(userId, id));
  }

  private async streamSource(resume: Resume): Promise<Response> {
    if (!resume.sourceFilename) {
      throw notFound("Resume has no source file");
    }
    try {
      return await streamFile(
        resumePath(resume.sourceFilename),
        resume.sourceMimeType ?? "application/pdf",
        resume.sourceFilename,
      );
    } catch {
      throw notFound("Source file missing on disk");
    }
  }

  async uploadSource(userId: string, id: string, file: File) {
    await this.findOwned(userId, id);
    const saved = await this.withSavedSource(file, async (source) =>
      this.prisma.$transaction(async (tx) => {
        await lockWorkUser(tx, userId);
        const resume = await findOwned(
          (where) =>
            tx.resume.findFirst({
              where,
              include: { _count: { select: { variants: true, applications: true } } },
            }),
          { id, userId },
          "Resume",
        );
        const updated = await tx.resume.updateMany({
          where: sourceReplacementWhere(resume),
          data: source,
        });
        if (updated.count !== 1)
          throw conflict(
            "The resume changed while uploading. Upload a new resume in Documents instead.",
          );
        return {
          source,
          previous: resume.sourceFilename,
          affected: await invalidateDocumentSelections(tx, userId, id),
        };
      }),
    );
    publishDocumentInvalidation(userId, saved.affected);
    if (saved.previous) await deleteResumeFile(saved.previous);
    return { id, sourceFilename: saved.source.sourceFilename };
  }

  async deleteSource(userId: string, id: string) {
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const resume = await findOwned(
        (where) => tx.resume.findFirst({ where }),
        { id, userId },
        "Resume",
      );
      await tx.resume.update({
        where: { id },
        data: { sourceFilename: null, sourceMimeType: null, sourceSizeBytes: null },
      });
      return {
        previous: resume.sourceFilename,
        affected: await invalidateDocumentSelections(tx, userId, id),
      };
    });
    publishDocumentInvalidation(userId, saved.affected);
    if (saved.previous) await deleteResumeFile(saved.previous);
    return { id };
  }

  /** Saves the upload, then runs the row write; a failed write removes the file it would have orphaned. */
  private async withSavedSource<T>(
    file: File,
    write: (source: SavedSource) => Promise<T>,
  ): Promise<T> {
    if (file.size > MAX_RESUME_BYTES) {
      throw badRequest("Resume must be 5 MB or less");
    }
    const sourceFilename = await saveResumeSource(file);
    try {
      return await write({
        sourceFilename,
        sourceMimeType: file.type || "application/pdf",
        sourceSizeBytes: file.size,
      });
    } catch (error) {
      await deleteResumeFile(sourceFilename);
      throw error;
    }
  }

  /** Conditional write rather than count-then-set, so two first uploads cannot both claim it. */
  private async claimPrimaryIfUnset(userId: string, resumeId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, primaryResumeId: null },
      data: { primaryResumeId: resumeId },
    });
  }
}
