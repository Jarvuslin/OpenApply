import { randomUUID } from "node:crypto";
import type {
  resumeVariantCreateSchema,
  resumeVariantPatchSchema,
} from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import { resumeChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { conflict, findOwned, notFound, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { Prisma, PrismaClient, type Resume } from "@/generated/prisma/client";
import {
  invalidateDocumentSelections,
  publishDocumentInvalidation,
} from "@/modules/application-question/document.invalidation";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { readContent, toStoredContent } from "../content";
import { ResumeEvidenceService } from "../evidence/resume-evidence.service";
import { ResumeService } from "../resume.service";
import { ResumeArtifactService } from "../resume-artifact.service";
import { buildTailoredVariant } from "../tailoring/build-variant";
import {
  notProtectedVariant,
  type pruneVariantsQuerySchema,
  type TailorVariantBody,
  type VariantRewriteAudit,
} from "./variant.schema";

type ResumeVariantCreateInput = z.infer<typeof resumeVariantCreateSchema>;
type ResumeVariantPatch = z.infer<typeof resumeVariantPatchSchema>;
type PruneVariantsQuery = z.infer<typeof pruneVariantsQuerySchema>;

@singleton()
export class ResumeVariantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resumes: ResumeService,
    private readonly artifacts: ResumeArtifactService,
    private readonly evidence: ResumeEvidenceService,
  ) {}

  private findVariant(userId: string, id: string) {
    return findOwned(
      (where) =>
        this.prisma.resumeVariant.findFirst({
          where,
          include: { resume: { select: { label: true } } },
        }),
      { id, resume: { userId } },
      "Variant",
    );
  }

  /** The link is the record of what was sent - a dangling id 404s rather than storing null. */
  private async assertApplicationOwned(
    userId: string,
    applicationId: string | null | undefined,
  ): Promise<void> {
    if (!applicationId) {
      return;
    }
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      select: { id: true },
    });
    if (!app) {
      throw notFound("Application not found");
    }
  }

  private async create(
    userId: string,
    base: Resume,
    data: Omit<Prisma.ResumeVariantUncheckedCreateInput, "resumeId">,
    jobDescription?: string,
    evidence: ResumeEvidenceSnapshot[] = [],
  ) {
    const id = randomUUID();
    const resumeId = base.id;
    const artifact = await this.artifacts.prepareVariant(
      userId,
      base,
      {
        id,
        content: data.content as Prisma.JsonValue,
        jobUrl: data.jobUrl ?? null,
        diffNotes: data.diffNotes ?? null,
        rewrites: (data.rewrites ?? null) as Prisma.JsonValue,
      },
      jobDescription,
    );
    let variant: { id: string };
    try {
      variant = await this.publishVariant(userId, base, { ...data, id, resumeId }, evidence);
    } catch (error) {
      await this.artifacts.removeFiles(userId, resumeId, id);
      throw error;
    }
    publish(
      resumeChannel,
      { resumeId },
      { type: "variant.created", resumeId, variantId: variant.id },
    );
    return { id: variant.id, artifact };
  }

  private async publishVariant(
    userId: string,
    base: Resume,
    data: Prisma.ResumeVariantUncheckedCreateInput,
    evidence: ResumeEvidenceSnapshot[],
  ) {
    const references = evidence.map((record) => ({
      evidenceId: record.id,
      revision: record.revision,
    }));
    if (references.length) await this.evidence.resolve(userId, base.id, references);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM resumes WHERE id = ${base.id} AND user_id = ${userId} FOR SHARE
      `;
      if (current[0]?.version !== base.version)
        throw conflict(
          "Resume changed during generation. Refresh the source and revise the draft.",
        );
      if (references.length) {
        // Keep a correction/retraction from racing between the final revision check and publication.
        const rows = await tx.$queryRaw<
          { id: string; revision: number; status: string }[]
        >(Prisma.sql`
        SELECT id, revision, status FROM resume_evidence
        WHERE resume_id = ${base.id} AND id IN (${Prisma.join(references.map((record) => record.evidenceId))})
        ORDER BY id FOR SHARE
      `);
        for (const reference of references) {
          const row = rows.find((record) => record.id === reference.evidenceId);
          if (row?.revision !== reference.revision || row.status !== "supported") {
            throw conflict(
              "Evidence changed during generation. Refresh the evidence and revise the draft.",
            );
          }
        }
      }
      return tx.resumeVariant.create({ data });
    });
  }

  /** Every delete path ends here, or stored artifacts would outlive their variant. */
  private async afterVariantsDeleted(
    userId: string,
    resumeId: string,
    ...ids: string[]
  ): Promise<void> {
    await Promise.all(ids.map((id) => this.artifacts.removeFiles(userId, resumeId, id)));
    publish(resumeChannel, { resumeId }, { type: "variant.deleted", resumeId, variantIds: ids });
  }

  async listVariants(userId: string, resumeId: string) {
    await this.resumes.findOwned(userId, resumeId);

    return this.prisma.resumeVariant.findMany({
      where: { resumeId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        resumeId: true,
        label: true,
        jobUrl: true,
        applicationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createVariant(userId: string, resumeId: string, body: ResumeVariantCreateInput) {
    const base = await this.resumes.findOwned(userId, resumeId);
    await this.assertApplicationOwned(userId, body.applicationId);

    const { id } = await this.create(userId, base, {
      ...body,
      content: toStoredContent(body.content),
    });
    return { id };
  }

  /**
   * The model writes prose and hint arrays, never structured ResumeData - `buildTailoredVariant`
   * applies them and rejects invented facts.
   */
  async createTailoredVariant(userId: string, resumeId: string, body: TailorVariantBody) {
    const base = await this.resumes.findOwned(userId, resumeId);
    if (base.content === null) {
      throw unprocessable("Base resume has no structured content. Run extract-resume first.");
    }
    await this.assertApplicationOwned(userId, body.applicationId);

    const groundings = [
      body.summaryGrounding,
      body.headlineGrounding,
      ...(body.bulletRewrites ?? []).flatMap((entry) =>
        entry.bullets.map((bullet) => bullet.grounding),
      ),
      ...(body.projectBulletRewrites ?? []).flatMap((entry) =>
        entry.bullets.map((bullet) => bullet.grounding),
      ),
    ];
    const references = groundings.flatMap((grounding) => grounding?.externalEvidence ?? []);
    const evidence = references.length
      ? await this.evidence.resolve(userId, resumeId, references)
      : [];
    const tailored = buildTailoredVariant(readContent(base.content), body, evidence);
    const { id, artifact } = await this.create(
      userId,
      base,
      {
        label: body.label,
        jobUrl: body.jobUrl,
        applicationId: body.applicationId,
        diffNotes: body.diffNotes,
        content: toStoredContent(tailored.content),
        rewrites: tailored.audit ? toInputJson(tailored.audit) : undefined,
      },
      body.jobDescription,
      evidence,
    );
    return {
      id,
      pdfUrl: artifact.pdfUrl,
      rewordedBullets: tailored.rewordedBullets,
      flags: tailored.flags,
    };
  }

  async getVariant(userId: string, id: string) {
    const variant = await this.findVariant(userId, id);

    return {
      id: variant.id,
      resumeId: variant.resumeId,
      resumeLabel: variant.resume.label,
      label: variant.label,
      jobUrl: variant.jobUrl,
      applicationId: variant.applicationId,
      content: readContent(variant.content),
      diffNotes: variant.diffNotes,
      rewrites: variant.rewrites as VariantRewriteAudit | null,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    };
  }

  async updateVariant(userId: string, id: string, body: ResumeVariantPatch) {
    await this.assertApplicationOwned(userId, body.applicationId);
    const affected = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const variant = await findOwned(
        (where) => tx.resumeVariant.findFirst({ where }),
        { id, resume: { userId } },
        "Variant",
      );
      await tx.resumeVariant.update({
        where: { id },
        data: {
          ...body,
          ...(body.content
            ? { content: toStoredContent(body.content), rewrites: Prisma.DbNull }
            : {}),
        },
      });
      return invalidateDocumentSelections(tx, userId, variant.resumeId, [id]);
    });
    publishDocumentInvalidation(userId, affected);
    return { id };
  }

  async removeVariant(userId: string, id: string) {
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const variant = await findOwned(
        (where) => tx.resumeVariant.findFirst({ where }),
        { id, resume: { userId } },
        "Variant",
      );
      await tx.resumeVariant.delete({ where: { id } });
      return {
        variant,
        affected: await invalidateDocumentSelections(tx, userId, variant.resumeId, [id]),
      };
    });
    publishDocumentInvalidation(userId, saved.affected);
    await this.afterVariantsDeleted(userId, saved.variant.resumeId, id);
    return { deleted: id };
  }

  /**
   * What the dashboard's Apply does to a suggested rewrite. One transaction: as two browser calls,
   * a dropped connection left the base rewritten with the suggestion still on offer.
   */
  async applyVariant(userId: string, id: string) {
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const variant = await findOwned(
        (where) => tx.resumeVariant.findFirst({ where }),
        { id, resume: { userId } },
        "Variant",
      );
      const updated = await tx.resume.update({
        where: { id: variant.resumeId },
        data: { content: toStoredContent(readContent(variant.content)), version: { increment: 1 } },
      });
      await tx.resumeVariant.delete({ where: { id } });
      return {
        updated,
        affected: await invalidateDocumentSelections(tx, userId, variant.resumeId),
      };
    });
    const resumeId = saved.updated.id;
    publishDocumentInvalidation(userId, saved.affected);
    publish(
      resumeChannel,
      { resumeId },
      { type: "content.updated", resumeId, version: saved.updated.version },
    );
    await this.afterVariantsDeleted(userId, resumeId, id);
    return { id: resumeId, version: saved.updated.version };
  }

  /** Never touches a variant linked to an application or a reserved label. */
  async pruneVariants(userId: string, resumeId: string, query: PruneVariantsQuery) {
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      await findOwned(
        (where) => tx.resume.findFirst({ where }),
        { id: resumeId, userId },
        "Resume",
      );
      const candidates = await tx.resumeVariant.findMany({
        where: {
          resumeId,
          ...notProtectedVariant,
          ...(query.unlinkedOnly !== false ? { applicationId: null } : {}),
          ...(query.before ? { createdAt: { lt: query.before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
        skip: query.keep,
      });
      const ids = candidates.map((variant) => variant.id);
      if (!ids.length) return { ids, count: 0, affected: [] as string[] };
      const result = await tx.resumeVariant.deleteMany({ where: { id: { in: ids } } });
      return {
        ids,
        count: result.count,
        affected: await invalidateDocumentSelections(tx, userId, resumeId, ids),
      };
    });
    publishDocumentInvalidation(userId, saved.affected);
    if (saved.ids.length) await this.afterVariantsDeleted(userId, resumeId, ...saved.ids);
    return { deleted: saved.count };
  }

  async renderVariantPdf(userId: string, id: string) {
    const variant = await this.findVariant(userId, id);
    return this.artifacts.currentPdf(userId, variant.resumeId, id);
  }
}
