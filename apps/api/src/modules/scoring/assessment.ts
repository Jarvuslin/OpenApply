import type { FitAssessment, FitContext, ScoreAssessmentInput } from "@openapply/contracts/scoring";
import { conflict, unprocessable } from "@/common/errors";
import { validatePreferenceChecks } from "./preference-checks";

type Span = ScoreAssessmentInput["assessments"][number]["evidence"][number];
type Basis = FitAssessment["basis"];

export function sameBasis(left: Basis, right: Basis): boolean {
  return (
    left.version === right.version &&
    left.resumeId === right.resumeId &&
    left.sourceSha256 === right.sourceSha256 &&
    left.sourceTextSha256 === right.sourceTextSha256 &&
    left.jobSha256 === right.jobSha256 &&
    left.preferencesSha256 === right.preferencesSha256
  );
}

function verifySpan(text: string, span: Span, label: string): void {
  if (
    span.end <= span.start ||
    span.end > text.length ||
    text.slice(span.start, span.end) !== span.quote ||
    !span.quote.trim()
  ) {
    throw unprocessable(
      `${label} must quote an exact nonempty source span using the context's string offsets.`,
    );
  }
}

function roleRelevance(
  context: FitContext,
  family: ScoreAssessmentInput["roleMatch"]["family"],
): FitAssessment["roleMatch"]["relevance"] {
  const roles = context.preferences.jobPreferences.roles;
  if (roles.length === 0) return "not_restricted";
  if (family === "Unclear") return "unclear";
  if (family === "Other") return "outside_preferences";
  if (roles.includes(family)) return "matched";
  // General software engineering includes application development, not every technical specialty.
  if (
    roles.includes("Software engineering") &&
    ["Frontend", "Backend", "Full stack", "Mobile"].includes(family)
  )
    return "matched";
  return "outside_preferences";
}

export function assessFit(context: FitContext, input: ScoreAssessmentInput): FitAssessment {
  if (!sameBasis(context.basis, input.basis))
    throw conflict(
      "Scoring inputs changed. Read a fresh scoring context before assessing this job.",
    );
  if (input.preferenceChecks) validatePreferenceChecks(context, input.preferenceChecks);
  const byId = new Map(input.assessments.map((item) => [item.criterionId, item]));
  if (
    byId.size !== input.assessments.length ||
    byId.size !== context.job.criteria.length ||
    context.job.criteria.some((item) => !byId.has(item.id))
  ) {
    throw unprocessable(
      "Assess every job criterion exactly once; missing, duplicate and unknown criterion IDs are rejected.",
    );
  }
  const assessments = context.job.criteria.map((criterion) => {
    const item = byId.get(criterion.id)!;
    if (criterion.isHeading && item.category !== "context")
      throw unprocessable(`Heading ${criterion.id} cannot contribute points.`);
    if ((item.category === "context") !== (item.rating === "not_applicable"))
      throw unprocessable(`Criterion ${criterion.id}: only context may be not_applicable.`);
    if (!item.explanation.trim())
      throw unprocessable(`Criterion ${criterion.id} needs an explanation, including exclusions.`);
    if (["strong", "partial", "contradicted"].includes(item.rating) && item.evidence.length === 0)
      throw unprocessable(
        `Criterion ${criterion.id}: ${item.rating} requires original-resume evidence.`,
      );
    for (const evidence of item.evidence)
      verifySpan(context.resume.text, evidence, `Criterion ${criterion.id} evidence`);
    return { ...item, criterion };
  });
  const scored = assessments.filter((item) => item.category !== "context");
  if (scored.length === 0)
    throw unprocessable(
      "At least one requirement or responsibility must be assessed; an all-context assessment cannot produce a score.",
    );
  for (const evidence of input.roleMatch.evidence)
    verifySpan(
      evidence.source === "title" ? context.job.title : context.job.description,
      evidence,
      "Role evidence",
    );
  const requirements = scored.filter((item) => item.category === "requirement");
  const responsibilities = scored.filter((item) => item.category === "responsibility");
  const points = (rating: (typeof scored)[number]["rating"]) => {
    if (rating === "strong") return 1;
    if (rating === "partial") return 0.5;
    return 0;
  };
  const component = (items: typeof scored, weight: number) => ({
    score: items.length
      ? Math.round((100 * items.reduce((sum, item) => sum + points(item.rating), 0)) / items.length)
      : null,
    count: items.length,
    weight: items.length ? weight : 0,
  });
  const components = {
    requirements: component(requirements, responsibilities.length ? 0.6 : 1),
    responsibilities: component(responsibilities, requirements.length ? 0.4 : 1),
  };
  const score = Math.round(
    (components.requirements.score ?? 0) * components.requirements.weight +
      (components.responsibilities.score ?? 0) * components.responsibilities.weight,
  );
  const uncertain = scored.filter((item) => item.rating === "uncertain").length;
  const relevance = roleRelevance(context, input.roleMatch.family);
  const needsReview =
    uncertain > 0 ||
    requirements.length === 0 ||
    responsibilities.length === 0 ||
    input.roleMatch.family === "Unclear";
  return {
    basis: context.basis,
    score,
    confidence: Math.round((100 * (scored.length - uncertain)) / scored.length) / 100,
    confidenceMeaning:
      "Fraction of scored criteria without an uncertain rating; not a probability of hiring.",
    judgment:
      "Semantic ratings are agent judgments; source quotations and score arithmetic are validated by the server.",
    verdict: needsReview ? "needs_review" : "assessed",
    components,
    assessments,
    roleMatch: { ...input.roleMatch, relevance },
    ...(input.preferenceChecks && { preferenceChecks: input.preferenceChecks }),
    strongMatches: scored
      .filter((item) => item.rating === "strong")
      .map((item) => item.criterion.text),
    partialMatches: scored
      .filter((item) => item.rating === "partial")
      .map((item) => item.criterion.text),
    gaps: scored
      .filter((item) => ["unsupported", "contradicted", "uncertain"].includes(item.rating))
      .map((item) => item.criterion.text),
    matchReason: `${score}/100 against the original resume: ${requirements.length} requirements and ${responsibilities.length} responsibilities assessed; role relevance ${relevance}.${needsReview ? " Agent review needed for uncertain or missing assessment categories." : ""}`,
  };
}
