import type { FitContext } from "@openapply/contracts/scoring";
import type {
  EvaluationEligibility,
  EvaluationFacts,
} from "@openapply/contracts/scoring-evaluation";
import { Country } from "country-state-city";
import { badRequest, unprocessable } from "@/common/errors";

const restrictions: {
  kind: EvaluationEligibility["restrictions"][number]["kind"];
  pattern: RegExp;
}[] = [
  {
    kind: "sponsorship",
    pattern: /\bno\s+(?:visa\s+)?sponsorship\b(?!\s+(?:restrictions?|limitations?|barriers?)\b)/gi,
  },
  {
    kind: "sponsorship",
    pattern:
      /\b(?:cannot|unable\s+to|will\s+not|do(?:es)?\s+not)\s+(?:provide|offer)\s+(?:visa\s+)?sponsorship\b/gi,
  },
  {
    kind: "authorization",
    pattern:
      /\b(?:must\s+be|required\s+to\s+be)\s+(?:legally\s+)?authorized\s+to\s+work\s+in\s+(?:the\s+)?(?:United\s+States|U\.S\.|Canada)(?=\s|[.,;:]|$)/gi,
  },
  {
    kind: "citizenship",
    pattern: /\b(?:U\.?S\.?|United\s+States|Canadian)\s+citizens?(?:hip)?\s+(?:only|required)\b/gi,
  },
  { kind: "clearance", pattern: /\bactive\s+(?:security\s+)?clearance\s+(?:is\s+)?required\b/gi },
];

function countries(text: string): string[] {
  const us = /\bUnited\s+States\b|\bU\.S\.(?:A\.)?|\bUS\s+citizens?/i.test(text);
  const ca = /\bCanada\b|\bCanadian\b/i.test(text);
  return [...(us ? ["US"] : []), ...(ca ? ["CA"] : [])];
}

export function evaluateEligibility(
  context: FitContext,
  facts: EvaluationFacts | null,
): EvaluationEligibility {
  if (facts && !Country.getCountryByCode(facts.countryCode))
    throw badRequest("Eligibility facts need an assigned ISO country code.");
  const findings: EvaluationEligibility["restrictions"] = [];
  for (const source of ["title", "description"] as const) {
    const text = context.job[source];
    for (const { kind, pattern } of restrictions) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const lineStart = Math.max(text.lastIndexOf("\n", start), text.lastIndexOf(";", start)) + 1;
        const boundaries = [text.indexOf("\n", end), text.indexOf(";", end)].filter(
          (index) => index !== -1,
        );
        const line = text.slice(
          lineStart,
          boundaries.length ? Math.min(...boundaries) : text.length,
        );
        // Negated descriptions are not restrictions; conditional mentions remain review evidence.
        if (
          /\b(?:not\s+(?:say|state|require)|does\s+not\s+mean)\b/i.test(line) ||
          /\bnot\s*$/i.test(text.slice(lineStart, start))
        )
          continue;
        const matchedCountries = countries(match[0]);
        const lineCountries = matchedCountries.length ? matchedCountries : countries(line);
        const scopes = lineCountries.length
          ? lineCountries
          : countries(`${context.job.title}\n${context.job.location ?? ""}`);
        const countryCode = scopes.length === 1 ? scopes[0] : null;
        let outcome: "met" | "not_met" | "unknown" = "unknown";
        if (
          facts &&
          countryCode === facts.countryCode &&
          !/\b(?:if|example|hypothetical)\b/i.test(line)
        ) {
          const value = {
            authorization: facts.authorized,
            sponsorship: facts.requiresSponsorship,
            citizenship: facts.citizen,
            clearance: facts.activeClearance,
          }[kind];
          if (value !== undefined) {
            const met = kind === "sponsorship" ? !value : value;
            outcome = met ? "met" : "not_met";
          }
        }
        if (
          !findings.some(
            (item) => item.kind === kind && item.source === source && item.start === start,
          )
        )
          findings.push({
            kind,
            source,
            start,
            end,
            quote: text.slice(start, end),
            countryCode,
            outcome,
          });
      }
    }
  }
  let outcome: EvaluationEligibility["outcome"] = "no_known_restriction";
  if (findings.length) {
    outcome = "eligible";
    if (findings.some((item) => item.outcome === "unknown")) outcome = "needs_review";
    if (findings.some((item) => item.outcome === "not_met")) outcome = "ineligible";
  }
  if (findings.length > 100)
    throw unprocessable("Eligibility evidence exceeds the bounded review limit.");
  return { outcome, facts, restrictions: findings };
}
