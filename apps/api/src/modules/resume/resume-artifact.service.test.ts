import { resumeDataSchema } from "@openapply/contracts/resume";
import { Prisma, type PrismaClient, type Resume } from "@/generated/prisma/client";
import type { ResumeEvidenceService } from "./evidence/resume-evidence.service";
import { ResumeService } from "./resume.service";
import { ResumeArtifactService } from "./resume-artifact.service";
import { ResumeVariantService } from "./variants/variant.service";
import { describe, expect, test } from "bun:test";

const owner = crypto.randomUUID();
const base = {
  id: crypto.randomUUID(),
  userId: owner,
  label: "Original",
  version: 1,
  content: resumeDataSchema.parse({ basics: { name: "Yuchen Lin" } }),
  sourceFilename: null,
  sourceMimeType: null,
  sourceSizeBytes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Resume;

describe("resume artifact service boundaries", () => {
  test("checks base ownership before attempting to read a saved revision", async () => {
    let filter: unknown;
    const db = {
      resume: {
        findFirst: async ({ where }: { where: unknown }) => {
          filter = where;
          return null;
        },
      },
    } as unknown as PrismaClient;
    await expect(
      new ResumeArtifactService(db).get(owner, base.id, undefined, "a".repeat(64)),
    ).rejects.toMatchObject({ status: 404 });
    expect(filter).toEqual({ id: base.id, userId: owner });
  });

  test("a variant must belong to both the owned base and user before reading files", async () => {
    const variantId = crypto.randomUUID();
    let filter: unknown;
    const db = {
      resume: { findFirst: async () => base },
      resumeVariant: {
        findFirst: async ({ where }: { where: unknown }) => {
          filter = where;
          return null;
        },
      },
    } as unknown as PrismaClient;
    await expect(
      new ResumeArtifactService(db).get(owner, base.id, variantId, "a".repeat(64)),
    ).rejects.toMatchObject({ status: 404 });
    expect(filter).toEqual({ id: variantId, resumeId: base.id, resume: { userId: owner } });
  });

  test("a rejected compile cannot publish a new variant row", async () => {
    let writes = 0;
    const db = {
      resumeVariant: {
        create: async () => {
          writes++;
        },
      },
    } as unknown as PrismaClient;
    const resumes = { findOwned: async () => base } as unknown as ResumeService;
    const artifacts = {
      prepareVariant: async () => {
        throw new Error("Resume requires two pages");
      },
    } as unknown as ResumeArtifactService;
    await expect(
      new ResumeVariantService(db, resumes, artifacts, {} as ResumeEvidenceService).createVariant(
        owner,
        base.id,
        {
          label: "Engineer",
          content: base.content,
        },
      ),
    ).rejects.toThrow("two pages");
    expect(writes).toBe(0);
  });

  test("tailoring returns the pinned PDF that was compiled before the row is published", async () => {
    let compiled = false;
    let source: unknown;
    let jd: unknown;
    const db = {
      $transaction: async (work: (tx: PrismaClient) => Promise<unknown>) => work(db),
      $queryRaw: async () => [{ version: base.version }],
      resumeVariant: {
        create: async ({ data }: { data: { id: string } }) => {
          expect(compiled).toBe(true);
          return { id: data.id };
        },
      },
    } as unknown as PrismaClient;
    const resumes = { findOwned: async () => base } as unknown as ResumeService;
    const pdfUrl = `/api/resumes/variants/${crypto.randomUUID()}/artifacts/${"b".repeat(64)}/pdf`;
    const artifacts = {
      prepareVariant: async (
        _user: string,
        original: Resume,
        _draft: unknown,
        description: string,
      ) => {
        source = original;
        jd = description;
        compiled = true;
        return { pdfUrl };
      },
    } as unknown as ResumeArtifactService;
    const result = await new ResumeVariantService(
      db,
      resumes,
      artifacts,
      {} as ResumeEvidenceService,
    ).createTailoredVariant(owner, base.id, {
      label: "Engineer",
      jobDescription: "Build software for customers.",
    });
    expect(result.pdfUrl).toBe(pdfUrl);
    expect(source).toBe(base);
    expect(jd).toBe("Build software for customers.");
  });

  test("saving extracted base content does not invoke the compiler", async () => {
    let writes = 0;
    const db = {
      $transaction: async (work: (tx: PrismaClient) => Promise<unknown>) => work(db),
      $queryRaw: async () => [],
      applicationDocumentSelection: { findMany: async () => [] },
      resume: {
        findFirst: async () => base,
        update: async () => {
          writes++;
          return { ...base, version: 2 };
        },
      },
    } as unknown as PrismaClient;
    const artifacts = new Proxy(
      {},
      {
        get() {
          throw new Error("Extraction must not compile");
        },
      },
    ) as ResumeArtifactService;
    const result = await new ResumeService(db, artifacts).update(owner, base.id, {
      content: base.content,
    });
    expect(result).toEqual({ id: base.id, version: 2 });
    expect(writes).toBe(1);
  });

  test("explicit regeneration of an unchanged variant keeps its saved source and JD", async () => {
    const variantId = crypto.randomUUID();
    const retained = {
      revision: "c".repeat(64),
      job: { description: "Original JD" },
      source: { version: 1 },
    };
    const db = {
      resume: { findFirst: async () => ({ ...base, version: 3 }) },
      resumeVariant: {
        findFirst: async () => ({
          id: variantId,
          content: base.content,
          rewrites: null,
          jobUrl: null,
          diffNotes: null,
        }),
      },
    } as unknown as PrismaClient;
    const service = new ResumeArtifactService(db);
    Object.assign(service, {
      store: {
        current: async () => retained,
        create: async () => {
          throw new Error("Must not replace retained provenance");
        },
      },
    });
    expect(await service.create(owner, base.id, variantId)).toMatchObject(retained);
  });

  test("raw variant edits remove review evidence that described earlier wording", async () => {
    let saved: unknown;
    const db = {
      $transaction: async (work: (tx: PrismaClient) => Promise<unknown>) => work(db),
      $queryRaw: async () => [],
      applicationDocumentSelection: { findMany: async () => [] },
      resumeVariant: {
        findFirst: async () => ({ id: "variant", resumeId: base.id }),
        update: async ({ data }: { data: unknown }) => {
          saved = data;
          return {};
        },
      },
    } as unknown as PrismaClient;
    await new ResumeVariantService(
      db,
      {} as ResumeService,
      {} as ResumeArtifactService,
      {} as ResumeEvidenceService,
    ).updateVariant(owner, "variant", { content: base.content });
    expect(saved).toMatchObject({ rewrites: Prisma.DbNull });
  });
});
