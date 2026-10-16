// Every validator returns violations; empty means accepted. Tailoring may rephrase a real
// accomplishment but never fabricate, drop a fact, or pad it with stock phrasing.
import type { ResumeData } from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import type { EntryRewriteAudit, TailorVariantBody } from "../variants/variant.schema";
import {
  buildCorpus,
  type Corpus,
  corpusFromText,
  droppedTerms,
  extractNumbers,
  unverifiedTerms,
} from "./facts";
import { reviewSources, unsupportedClaims } from "./source-review";

/**
 * Stock resume phrasing that reads as machine-written. Matched whole-word, case-insensitive.
 * `plugin/skills/tailor-resume/SKILL.md` lists these so the agent avoids a 422; keep it in sync.
 */
const STOCK_PHRASES = [
  "comfortable with",
  "comfortable moving",
  "comfortable working",
  "hands-on",
  "hands on experience",
  "enjoys",
  "passionate",
  "results-driven",
  "results driven",
  "detail-oriented",
  "self-starter",
  "fast-paced",
  "track record",
  "cutting-edge",
  "state-of-the-art",
  "leverage",
  "leveraging",
  "spearheaded",
  "seasoned",
  "stakeholders",
  "business requirements",
  "production-grade",
  "best practices",
  "cross-functional",
  "end-to-end",
  "end to end",
  "picking up",
  "quick learner",
  "eager to",
  "thrives",
  "suited to",
  "the same",
  "downstream",
].map((phrase) => ({
  phrase,
  pattern: new RegExp(`(^|[^a-z])${phrase.replace(/[-.]/g, "\\$&")}([^a-z]|$)`),
}));

/** The stock phrases `text` uses. */
function stockPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return STOCK_PHRASES.filter(({ pattern }) => pattern.test(lower)).map(({ phrase }) => phrase);
}

const SUMMARY_MAX_SENTENCES = 3;

function countSentences(text: string): number {
  return text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim()).length;
}

/** Violations for a tailored summary. */
export function validateSummary(_baseSummary: string, summary: string, corpus: Corpus): string[] {
  const violations: string[] = [];

  const stock = stockPhrases(summary);
  if (stock.length > 0) {
    violations.push(`summary uses stock phrasing (${stock.join(", ")}); say the specific thing.`);
  }
  const sentences = countSentences(summary);
  if (sentences > SUMMARY_MAX_SENTENCES) {
    violations.push(`summary has ${sentences} sentences; keep it to ${SUMMARY_MAX_SENTENCES}.`);
  }
  const newNumbers = [...extractNumbers(summary)].filter((n) => !corpus.numbers.has(n));
  if (newNumbers.length > 0) {
    violations.push(
      `summary introduces number(s) the resume never states (${newNumbers.join(", ")}).`,
    );
  }
  const unverified = unverifiedTerms(summary, corpus);
  if (unverified.length > 0) {
    violations.push(`summary names tech the resume never mentions (${unverified.join(", ")}).`);
  }

  if (summary.length > 1_000)
    violations.push("summary exceeds 1,000 characters; keep the review bounded");
  return violations;
}

/** Violations for a retargeted headline. */
export function validateHeadline(headline: string, corpus: Corpus): string[] {
  const violations: string[] = [];
  const stock = stockPhrases(headline);
  if (stock.length > 0) {
    violations.push(`headline uses stock phrasing (${stock.join(", ")}).`);
  }
  const unverified = unverifiedTerms(headline, corpus);
  if (unverified.length > 0) {
    violations.push(`headline names tech the resume never mentions (${unverified.join(", ")}).`);
  }
  const numbers = [...extractNumbers(headline)].filter((number) => !corpus.numbers.has(number));
  if (numbers.length)
    violations.push(`headline introduces unsupported number(s) (${numbers.join(", ")}).`);
  return violations;
}

type BulletRewrite = NonNullable<TailorVariantBody["bulletRewrites"]>[number];

interface RewriteValidation {
  /** Hard-guard failures. Non-empty ⇒ reject the whole request. */
  violations: string[];
  /** Per-entry audit of accepted rewrites. */
  audit: EntryRewriteAudit[];
  /** entryIndex → (trimmed original → tailored), for applying in `tailorBase`. */
  map: Map<number, Map<string, string>>;
}

const BULLET_MAX_LENGTH = 1_000;

/** A new metric keeps its complete cited statement, including the outcome and unit it measures. */
export function unsupportedAddedMeasurements(
  original: string,
  tailored: string,
  statements: string[],
): string[] {
  const originalNumbers = extractNumbers(original);
  const unsupported = [...extractNumbers(tailored)].filter(
    (number) =>
      !originalNumbers.has(number) &&
      !statements.some(
        (statement) => extractNumbers(statement).has(number) && tailored.includes(statement),
      ),
  );
  return unsupported.length
    ? [
        `introduces number(s) without their complete cited outcome statement (${unsupported.join(", ")})`,
      ]
    : [];
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function bulletProblem(
  original: string,
  tailored: string,
  evidence: string,
  recognized: string[],
  completeStatements: string[],
): string | null {
  const originalNumbers = extractNumbers(original);
  const tailoredNumbers = extractNumbers(tailored);
  const measurements = unsupportedAddedMeasurements(original, tailored, completeStatements);
  if (measurements.length) return measurements.join("; ");
  const dropped = [...originalNumbers].filter((n) => !tailoredNumbers.has(n));
  if (dropped.length > 0) {
    return `drops number(s) the original stated (${dropped.join(", ")})`;
  }
  const unverified = unverifiedTerms(tailored, corpusFromText(evidence, recognized));
  if (unverified.length > 0) {
    return `names tools or identities absent from the cited entry (${unverified.join(", ")})`;
  }
  const droppedTech = droppedTerms(original, tailored);
  if (droppedTech.length > 0) {
    return `drops tech the original named (${droppedTech.join(", ")})`;
  }
  const stock = stockPhrases(tailored);
  if (stock.length > 0) {
    return `uses stock phrasing (${stock.join(", ")})`;
  }
  if (tailored.length > BULLET_MAX_LENGTH) {
    return `exceeds ${BULLET_MAX_LENGTH} characters; tighten the supported wording`;
  }
  let metricText = tailored;
  for (const statement of completeStatements) {
    if ([...extractNumbers(statement)].some((number) => !originalNumbers.has(number))) {
      metricText = metricText.replaceAll(statement, "");
    }
  }
  const claims = unsupportedClaims(
    metricText,
    evidence,
    originalNumbers.size ? original : undefined,
  );
  if (claims.length) return claims.join("; ");
  return null;
}

/**
 * `experience[].bullets` on the base is the master set. Any failure rejects the whole request: the
 * original must be a real bullet of an existing entry, rewritten once, and pass `bulletProblem`.
 */
export function validateRewrites(
  base: ResumeData,
  rewrites: BulletRewrite[],
  jobDescription?: string,
  section: "experience" | "projects" = "experience",
  additionalEvidence: ResumeEvidenceSnapshot[] = [],
): RewriteValidation {
  const violations: string[] = [];
  const audit: EntryRewriteAudit[] = [];
  const map = new Map<number, Map<string, string>>();
  const entries = section === "experience" ? base.experience : base.projects;
  const seenEntries = new Set<number>();
  const recognized = buildCorpus(base).recognized;

  for (const { entryIndex, bullets } of rewrites) {
    const entry = entries[entryIndex];
    if (!entry) {
      violations.push(`${section} entry ${entryIndex} does not exist.`);
      continue;
    }
    if (seenEntries.has(entryIndex)) {
      violations.push(`${section} entry ${entryIndex} has duplicate rewrite groups.`);
      continue;
    }
    seenEntries.add(entryIndex);

    const company = "company" in entry ? entry.company : entry.name;
    const masterSet = new Set((entry.bullets ?? []).map((b) => b.trim()));
    const entryMap = new Map<string, string>();
    const reviewed: EntryRewriteAudit["bullets"] = [];

    for (const pair of bullets) {
      const original = pair.original.trim();
      const tailored = pair.tailored.trim();

      if (!tailored) {
        violations.push(`${company}: empty tailored bullet for "${truncate(original)}".`);
      } else if (!masterSet.has(original)) {
        violations.push(
          `${company}: original bullet not found in the base resume: "${truncate(original)}".`,
        );
      } else if (entryMap.has(original)) {
        violations.push(`${company}: bullet rewritten more than once: "${truncate(original)}".`);
      } else {
        const bulletIndex = entry.bullets.findIndex((bullet) => bullet.trim() === original);
        const source = reviewSources(
          base,
          pair.grounding,
          jobDescription,
          {
            scope: `/${section}/${entryIndex}`,
            path: `/${section}/${entryIndex}/bullets/${bulletIndex}`,
            original,
          },
          additionalEvidence,
        );
        const problem = source.violations.length
          ? source.violations.join("; ")
          : bulletProblem(original, tailored, source.text, recognized, source.completeStatements);
        if (problem) {
          violations.push(`${company}: reworded bullet ${problem}: "${truncate(tailored)}".`);
        } else {
          entryMap.set(original, tailored);
          reviewed.push({ original, tailored, grounding: pair.grounding });
        }
      }
    }

    if (entryMap.size > 0) {
      map.set(entryIndex, entryMap);
      audit.push({
        entryIndex,
        company,
        bullets: reviewed,
      });
    }
  }

  return { violations, audit, map };
}
