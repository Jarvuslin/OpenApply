import type { ResumeData } from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import type { RewriteGrounding } from "../variants/variant.schema";

const EVIDENCE_ROOTS = new Set([
  "basics",
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "publications",
  "awards",
  "certifications",
  "sections",
]);

function sourceString(base: ResumeData, path: string): string | null {
  const parts = path.split("/").slice(1);
  if (!path.startsWith("/") || !EVIDENCE_ROOTS.has(parts[0]) || parts.includes("id")) return null;
  let value: unknown = base;
  for (const part of parts) {
    if (!part || value === null || typeof value !== "object" || !Object.hasOwn(value, part))
      return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : null;
}

/** Checks references and recorded review, not the truth of the agent's semantic judgment. */
export function reviewSources(
  base: ResumeData,
  grounding: RewriteGrounding | undefined,
  jobDescription?: string,
  anchor?: { scope: string; path: string; original: string },
  additionalEvidence: ResumeEvidenceSnapshot[] = [],
): { violations: string[]; text: string; completeStatements: string[] } {
  const violations: string[] = [];
  const completeStatements: string[] = [];
  const quotes: string[] = [];
  if (!grounding)
    return {
      violations: ["requires source evidence, a target and factual review"],
      text: "",
      completeStatements,
    };
  const { evidence, target, review } = grounding;
  if (!evidence?.length) violations.push("requires at least one source quotation");
  for (const item of evidence ?? []) {
    const source = sourceString(base, item.path);
    if (!item.quote?.trim() || source === null || !source.includes(item.quote)) {
      violations.push(`evidence ${item.path} must quote the selected base exactly`);
    }
    if (anchor && !item.path.startsWith(`${anchor.scope}/`)) {
      violations.push(`evidence ${item.path} belongs to a different employment or project`);
    }
    if (source?.includes(item.quote)) {
      quotes.push(item.quote);
      if (item.quote === source) completeStatements.push(source);
    }
  }
  for (const item of grounding.externalEvidence ?? []) {
    const source = additionalEvidence.find(
      (record) => record.id === item.evidenceId && record.revision === item.revision,
    );
    if (source?.status !== "supported") {
      violations.push(
        `external evidence ${item.evidenceId} requires a current supported owned record`,
      );
      continue;
    }
    if (anchor && source.scope !== anchor.scope) {
      violations.push(
        `external evidence ${item.evidenceId} belongs to a different employment or project`,
      );
    }
    if (!item.quote?.trim() || source.statement !== item.quote) {
      violations.push(
        `external evidence ${item.evidenceId} must quote its complete saved statement exactly`,
      );
      continue;
    }
    quotes.push(item.quote);
    if (item.quote === source.statement) completeStatements.push(source.statement);
  }
  if (
    anchor &&
    !evidence?.some((item) => item.path === anchor.path && item.quote === anchor.original)
  ) {
    violations.push("must cite the complete original bullet at its base source path");
  }
  if (!target?.quote?.trim() || !target.reason?.trim())
    violations.push("requires a specific rewrite target and reason");
  if (target?.kind === "job_description" && !jobDescription?.includes(target.quote)) {
    violations.push("job target must quote the supplied full job description exactly");
  }
  if (target?.kind !== "job_description" && target?.kind !== "general_review")
    violations.push("invalid rewrite target kind");
  if (
    review?.verdict !== "supported" ||
    !review.rationale?.trim() ||
    !["explicit", "supported_interpretation"].includes(review.claimType)
  ) {
    violations.push("requires an explicit supported factual-review verdict and rationale");
  }
  return { violations, text: quotes.join("\n"), completeStatements };
}

const CLAIM_FAMILIES = [
  {
    label: "ownership/leadership",
    pattern:
      /\b(?:led|leading|leadership|owned|ownership|managed|management|directed|founded|mentored|supervised)\b/i,
  },
  { label: "production deployment", pattern: /\b(?:production|deployed|deployment)\b/i },
  {
    label: "customer adoption",
    pattern: /\b(?:customers?|clients?|adopted|adoption|subscribers?)\b/i,
  },
  {
    label: "organization-wide scope",
    pattern: /\b(?:enterprise|company-wide|organization-wide|cross-team)\b/i,
  },
  { label: "clinical scope", pattern: /\b(?:clinical|hospitals?|patients?|medical)\b/i },
  { label: "seniority", pattern: /\b(?:senior|principal|staff|expert)\b/i },
  {
    label: "financial outcome",
    measurement: true,
    pattern: /\b(?:revenue|profit|profitability|sales|income)\b/i,
  },
  {
    label: "cost outcome",
    measurement: true,
    pattern: /\b(?:costs?|expenditure|spend|savings)\b/i,
  },
  {
    label: "performance measurement",
    measurement: true,
    pattern: /\b(?:latency|throughput|response time)\b/i,
  },
];

export function unsupportedClaims(text: string, evidence: string, metricAnchor?: string): string[] {
  return CLAIM_FAMILIES.filter(
    (claim) =>
      claim.pattern.test(text) &&
      !claim.pattern.test(claim.measurement && metricAnchor ? metricAnchor : evidence),
  ).map((claim) => `${claim.label} is not supported by the cited source`);
}
