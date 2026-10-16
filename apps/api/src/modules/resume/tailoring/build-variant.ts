import type { ResumeData } from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import { unprocessable } from "@/common/errors";
import type { TailorVariantBody, VariantRewriteAudit } from "../variants/variant.schema";
import { buildCorpus, corpusFromText } from "./facts";
import {
  unsupportedAddedMeasurements,
  validateHeadline,
  validateRewrites,
  validateSummary,
} from "./guards";
import { tailorBase } from "./rank";
import { reviewSources, unsupportedClaims } from "./source-review";
import { applyStructure } from "./structure";

interface TailoredVariant {
  content: ResumeData;
  /** Null when nothing was reworded or restructured. */
  audit: VariantRewriteAudit | null;
  rewordedBullets: number;
  flags: string[];
}

/** Evidence paths and indexes always address the original base, before explicit structure moves. */
export function buildTailoredVariant(
  base: ResumeData,
  body: TailorVariantBody,
  additionalEvidence: ResumeEvidenceSnapshot[] = [],
): TailoredVariant {
  const summary = body.summary?.trim();
  const headline = body.headline?.trim();
  const rewrites = validateRewrites(
    base,
    body.bulletRewrites ?? [],
    body.jobDescription,
    "experience",
    additionalEvidence,
  );
  const projects = validateRewrites(
    base,
    body.projectBulletRewrites ?? [],
    body.jobDescription,
    "projects",
    additionalEvidence,
  );
  const violations = [...rewrites.violations, ...projects.violations];
  const recognized = buildCorpus(base).recognized;
  const audit: VariantRewriteAudit = {
    experience: rewrites.audit,
    projects: projects.audit.map(({ company, ...entry }) => ({ ...entry, name: company })),
    reviewMeaning:
      "Source references and factual invariants are checked; semantic support is an agent review judgment, not proof.",
  };
  for (const field of ["summary", "headline"] as const) {
    const tailored = field === "summary" ? summary : headline;
    const original = field === "summary" ? (base.summary ?? "") : (base.basics.headline ?? "");
    if (!tailored || tailored === original) continue;
    const grounding = field === "summary" ? body.summaryGrounding : body.headlineGrounding;
    const source = reviewSources(
      base,
      grounding,
      body.jobDescription,
      undefined,
      additionalEvidence,
    );
    violations.push(...source.violations.map((issue) => `${field}: ${issue}`));
    if (source.violations.length) continue;
    const corpus = corpusFromText(source.text, recognized);
    violations.push(
      ...(field === "summary"
        ? validateSummary(original, tailored, corpus)
        : validateHeadline(tailored, corpus)),
    );
    violations.push(
      ...unsupportedClaims(tailored, source.text).map((issue) => `${field}: ${issue}`),
      ...unsupportedAddedMeasurements(original, tailored, source.completeStatements).map(
        (issue) => `${field}: ${issue}`,
      ),
    );
    if (grounding) audit[field] = { original, tailored, grounding };
  }
  const proseChanged =
    rewrites.audit.some((entry) =>
      entry.bullets.some((bullet) => bullet.original !== bullet.tailored),
    ) ||
    projects.audit.some((entry) =>
      entry.bullets.some((bullet) => bullet.original !== bullet.tailored),
    ) ||
    Boolean(audit.summary || audit.headline);
  const flags: string[] = [];
  if (proseChanged && !body.workflowReview)
    violations.push(
      "Changed prose requires workflowReview with an evidence plan, independent reviewer and humanizer execution status",
    );
  if (body.workflowReview) {
    audit.workflowReview = body.workflowReview;
    audit.reviewEvidenceMeaning =
      "Agent-reported workflow; tool execution and semantic correctness are not established by these fields.";
    for (const [name, stage] of Object.entries({
      "Independent review": body.workflowReview.reviewer,
      Humanizer: body.workflowReview.humanizer,
    })) {
      if (stage.status === "unavailable") flags.push(`${name} incomplete: ${stage.reason}`);
    }
  }
  if (additionalEvidence.length) audit.additionalEvidence = additionalEvidence;
  if (violations.length > 0) {
    throw unprocessable("Tailor validation failed", violations);
  }

  const ranked = tailorBase(base, body, rewrites.map, projects.map);
  const omissions: NonNullable<VariantRewriteAudit["omissions"]> = [];
  if (body.maxBulletsPerEntry !== undefined) {
    for (const section of ["experience", "projects"] as const) {
      base[section].forEach((entry, entryIndex) => {
        const edits = (section === "experience" ? rewrites : projects).map.get(entryIndex);
        for (const original of entry.bullets) {
          if (
            !ranked[section][entryIndex].bullets.includes(edits?.get(original.trim()) ?? original)
          ) {
            omissions.push({
              section,
              entryIndex,
              original,
              reason: `Requested maxBulletsPerEntry=${body.maxBulletsPerEntry}`,
            });
          }
        }
      });
    }
  }
  if (omissions.length) audit.omissions = omissions;
  const structure = body.structure ? applyStructure(ranked, body.structure) : null;
  if (structure && !structure.ok)
    throw unprocessable("Structure validation failed", structure.violations);
  const rewordedBullets = [...rewrites.audit, ...projects.audit].reduce(
    (n, entry) => n + entry.bullets.length,
    0,
  );
  const structureAudit = structure?.audit;
  if (structureAudit) audit.structure = structureAudit;
  const changed =
    rewordedBullets > 0 ||
    structureAudit ||
    audit.summary ||
    audit.headline ||
    omissions.length > 0;

  return {
    content: structure?.content ?? ranked,
    audit: changed ? audit : null,
    rewordedBullets,
    flags: [...flags, ...(structureAudit?.flags ?? [])],
  };
}
