import { resumeDataSchema } from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import { conflict } from "@/common/errors";
import type { PrismaClient, Resume } from "@/generated/prisma/client";
import type { ResumeEvidenceService } from "../evidence/resume-evidence.service";
import type { ResumeService } from "../resume.service";
import type { ResumeArtifactService } from "../resume-artifact.service";
import type { VariantRewriteAudit } from "../variants/variant.schema";
import { ResumeVariantService } from "../variants/variant.service";
import { grounding, workflowReview } from "./fakes";
import { describe, expect, test } from "bun:test";

const owner = crypto.randomUUID();
const resumeId = crypto.randomUUID();
const original = "Built Python scripts for reports.";
const evidence: ResumeEvidenceSnapshot = {
  id: crypto.randomUUID(),
  resumeId,
  revision: 1,
  status: "supported",
  scope: "/experience/0",
  statement: "Used SQL queries to validate report rows.",
  source: {
    kind: "resume",
    version: 1,
    path: "/experience/0",
    quote: "Used SQL queries to validate report rows.",
  },
  review: {
    claimType: "explicit",
    context: "personal_assertion",
    rationale: "Exact owned user assertion.",
  },
  verification: {
    resumeVersion: 1,
    scopeSha256: "b".repeat(64),
    sourceSha256: "a".repeat(64),
    sourceRecord: "Resume source",
    sourceUrl: null,
    authorLogin: null,
    limitation: "Semantic support remains an agent judgment.",
  },
  optionalQuestion: null,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
};
const base: Resume = {
  id: resumeId,
  userId: owner,
  label: "Original",
  version: 1,
  content: resumeDataSchema.parse({
    basics: { name: "Sample Applicant" },
    experience: [{ company: "ExampleCo", title: "Intern", start: "2024", bullets: [original] }],
  }),
  sourceFilename: null,
  sourceMimeType: null,
  sourceSizeBytes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function harness(
  options: {
    changeDuringCompile?: boolean;
    changeAfterResolve?: boolean;
    changeBaseDuringCompile?: boolean;
    deleteBaseDuringCompile?: boolean;
    changeOwnerDuringCompile?: boolean;
  } = {},
) {
  let compiled = false;
  let cleaned = false;
  let writes = 0;
  let resolves = 0;
  let draft: { rewrites: VariantRewriteAudit } | undefined;
  let revision = 1;
  let version = 1;
  let currentOwner: string | null = owner;
  const resolutionCalls: unknown[] = [];
  const queryCalls: unknown[] = [];
  const tx = {
    $queryRaw: async (...args: unknown[]) => {
      queryCalls.push(args);
      if (queryCalls.length !== 1) return [{ id: evidence.id, revision, status: "supported" }];
      expect((args[0] as TemplateStringsArray).join("?")).toMatch(
        /WHERE id = \? AND user_id = \? FOR SHARE/,
      );
      expect(args.slice(1)).toEqual([resumeId, owner]);
      return currentOwner === owner ? [{ version }] : [];
    },
    resumeVariant: {
      create: async ({ data }: { data: { id: string } }) => {
        expect(compiled).toBe(true);
        writes++;
        return { id: data.id };
      },
    },
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      if (options.changeAfterResolve) revision++;
      return run(tx);
    },
  } as unknown as PrismaClient;
  const ledger = {
    resolve: async (...args: unknown[]) => {
      resolves++;
      resolutionCalls.push(args);
      if (revision !== 1) throw conflict("Evidence corrected during generation");
      return [evidence];
    },
  } as unknown as ResumeEvidenceService;
  const artifacts = {
    prepareVariant: async (
      _user: string,
      _base: Resume,
      value: { rewrites: VariantRewriteAudit },
    ) => {
      draft = value;
      compiled = true;
      if (options.changeDuringCompile) revision++;
      if (options.changeBaseDuringCompile) version++;
      if (options.deleteBaseDuringCompile) currentOwner = null;
      if (options.changeOwnerDuringCompile) currentOwner = "another-owner";
      return { pdfUrl: "/registered/pdf" };
    },
    removeFiles: async (userId: string, id: string, variantId: string) => {
      expect(userId).toBe(owner);
      expect(id).toBe(resumeId);
      expect(variantId).toBeString();
      cleaned = true;
    },
  } as unknown as ResumeArtifactService;
  const service = new ResumeVariantService(
    db,
    { findOwned: async () => base } as unknown as ResumeService,
    artifacts,
    ledger,
  );
  const review = grounding("/experience/0/bullets/0", original);
  review.externalEvidence = [{ evidenceId: evidence.id, revision: 1, quote: evidence.statement }];
  return {
    runWithoutEvidence: (kind: "raw" | "tailored") => {
      if (kind === "raw")
        return service.createVariant(owner, resumeId, {
          label: "Draft",
          content: resumeDataSchema.parse(base.content),
        });
      return service.createTailoredVariant(owner, resumeId, { label: "Tailored draft" });
    },
    run: () =>
      service.createTailoredVariant(owner, resumeId, {
        label: "Synthetic preview",
        workflowReview: workflowReview(),
        bulletRewrites: [
          {
            entryIndex: 0,
            bullets: [
              {
                original,
                tailored: "Built Python report scripts with SQL queries to validate rows.",
                grounding: review,
              },
            ],
          },
        ],
      }),
    state: () => ({ compiled, cleaned, writes, resolves, draft, resolutionCalls, queryCalls }),
  };
}

describe("evidence-backed artifact publication", () => {
  test("resolves owned evidence, snapshots it and rechecks revisions after compilation", async () => {
    const fixture = harness();
    const result = await fixture.run();
    expect(result.pdfUrl).toBe("/registered/pdf");
    const state = fixture.state();
    expect(state.resolves).toBe(2);
    expect(state.resolutionCalls[0]).toMatchObject([
      owner,
      resumeId,
      [{ evidenceId: evidence.id, revision: 1 }],
    ]);
    expect(state.draft?.rewrites.additionalEvidence).toEqual([evidence]);
    expect(state.queryCalls).toHaveLength(2);
    expect(state.writes).toBe(1);
    expect(state.cleaned).toBe(false);
  });

  for (const options of [
    { changeDuringCompile: true },
    { changeAfterResolve: true },
    { changeBaseDuringCompile: true },
    { deleteBaseDuringCompile: true },
    { changeOwnerDuringCompile: true },
  ]) {
    test(`rejects a concurrent correction without publishing a variant: ${JSON.stringify(options)}`, async () => {
      const fixture = harness(options);
      await expect(fixture.run()).rejects.toMatchObject({ status: 409 });
      expect(fixture.state()).toMatchObject({ compiled: true, cleaned: true, writes: 0 });
    });
  }
});

describe("artifact publication without additional evidence", () => {
  for (const kind of ["raw", "tailored"] as const) {
    test(`${kind}: locks the owned base before publication without an empty evidence query`, async () => {
      const fixture = harness();
      await fixture.runWithoutEvidence(kind);
      expect(fixture.state()).toMatchObject({
        compiled: true,
        cleaned: false,
        writes: 1,
        resolves: 0,
      });
      expect(fixture.state().queryCalls).toHaveLength(1);
    });

    for (const options of [
      { changeBaseDuringCompile: true },
      { deleteBaseDuringCompile: true },
      { changeOwnerDuringCompile: true },
    ]) {
      test(`${kind}: removes compiled files after base conflict ${JSON.stringify(options)}`, async () => {
        const fixture = harness(options);
        await expect(fixture.runWithoutEvidence(kind)).rejects.toMatchObject({ status: 409 });
        expect(fixture.state()).toMatchObject({
          compiled: true,
          cleaned: true,
          writes: 0,
          resolves: 0,
        });
      });
    }
  }
});
