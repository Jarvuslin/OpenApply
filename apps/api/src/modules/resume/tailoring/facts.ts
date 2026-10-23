import type { ResumeData } from "@openapply/contracts/resume";
import {
  hasWholeToken,
  matchesTerm,
  normalizeMatchPhrase,
  toSearchText,
} from "@/modules/scoring/keyword-normalize";
import { SYNONYM_GROUPS } from "@/modules/scoring/synonyms.data";

/** What a resume states as fact: its numbers and its tech names. */
export interface Corpus {
  /** Normalized for whole-token search. */
  search: string;
  /** Every number the resume states, normalized. */
  numbers: Set<string>;
  /** Recognizable source names and tools; recognition does not grant evidence for their use. */
  recognized: string[];
}

function normalizeNumber(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").replace(/,/g, "").replace(/\.+$/, "");
}

/**
 * Each number with its unit (`40%`) and bare (`40`), so rewording the unit ("40 percent") is not a
 * new number while a different magnitude still is.
 */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const normalizedUnits = text.replace(/(\d)\s*percent\b/gi, "$1%");
  for (const match of normalizedUnits.matchAll(/\d[\d.,]*(?:%|\+)?[kmbx]?/gi)) {
    const full = normalizeNumber(match[0]);
    if (!full) continue;
    out.add(full);
    const core = full.replace(/[%+kmbx]+$/i, "");
    if (core) out.add(core);
  }
  return out;
}

/** A token that looks like a technology or proper noun rather than ordinary prose. */
function isTechLike(token: string): boolean {
  if (/\d/.test(token) && /[a-z]/i.test(token)) return true; // s3, ec2, oauth2
  if (/[a-z][A-Z]/.test(token)) return true; // GraphQL, PostgreSQL, TypeScript
  if (/^[A-Z]{2,6}$/.test(token)) return true; // AWS, GCP, SQL, REST, HIPAA
  if (/[.+#]/.test(token) && /[a-z]/i.test(token)) return true; // .NET, Node.js, C++, C#
  if (/^[A-Z][a-z]{1,}$/.test(token) && !PROSE_OPENERS.has(token.toLowerCase())) return true;
  return false;
}

const PROSE_OPENERS = new Set(
  "built developed implemented created exposed separated handled configured routed parsed cached queued authenticated authorized shipped delivered released cut reduced lowered decreased automated improved achieved reached designed tested wrote produced maintained supported integrated evaluated migrated analyzed optimized repaired validated added enabled replaced strengthened refined generated made worked used using with through by for a an the engineer engineering developer development software senior junior frontend backend full stack machine learning data clinical real time recent trained applied results automated reporting reduced improved accelerated expanded simplified increased enhanced connected streamlined resolved processed delivered researched documented collaborated contributed".split(
    " ",
  ),
);

const AMBIGUOUS_TERMS = new Set(["next", "node", "go", "rails", "rest", "bi", "rn", "np"]);
const KNOWN_TERMS = [
  ...SYNONYM_GROUPS.flat().filter((term) => !AMBIGUOUS_TERMS.has(term)),
  "python",
  "java",
  "ruby",
  "rust",
  "swift",
  "kotlin",
  "docker",
  "terraform",
  "pytorch",
  "tensorflow",
  "pandas",
  "numpy",
  "redis",
  "mongodb",
  "sqlite",
  "mysql",
  "linux",
  "git",
  "github",
  "html",
  "css",
  "rest",
  "grpc",
];

function techTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawToken of text.split(/[\s,;:()/]+/)) {
    // A sentence period is punctuation; a dotted name like Node.js keeps its inner dot.
    const token = rawToken.replace(/^[^A-Za-z0-9.+#]+|[^A-Za-z0-9+#]+$/g, "");
    if (!token || !isTechLike(token)) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export function buildCorpus(base: ResumeData): Corpus {
  const parts: string[] = [base.summary ?? "", base.basics?.headline ?? ""];
  for (const entry of base.experience ?? []) {
    parts.push(entry.company, entry.title, ...(entry.bullets ?? []));
  }
  for (const project of base.projects ?? []) {
    parts.push(
      project.name,
      project.description ?? "",
      ...(project.bullets ?? []),
      ...(project.keywords ?? []),
    );
  }
  for (const group of base.skills ?? []) {
    parts.push(...(group.items ?? []));
  }
  // A research CV's evidence for a technique lives in its publication titles and its grants, not in
  // a job bullet, so leaving these out rejects terms the resume genuinely supports.
  for (const publication of base.publications ?? []) {
    parts.push(publication.title, publication.venue ?? "");
  }
  for (const certification of base.certifications ?? []) {
    parts.push(certification.name);
  }
  for (const section of base.sections ?? []) {
    for (const entry of section.entries ?? []) {
      parts.push(entry.heading, entry.subheading ?? "", ...(entry.bullets ?? []));
    }
  }
  const raw = parts.join(" ");
  return corpusFromText(raw);
}

export function corpusFromText(text: string, recognized: string[] = []): Corpus {
  return {
    search: toSearchText(text),
    numbers: extractNumbers(text),
    recognized: [...new Set([...KNOWN_TERMS, ...recognized, ...techTokens(text)])],
  };
}

/** Lexical checks cover quantities and recognizable names; recorded review covers semantics. */
export function unverifiedTerms(text: string, corpus: Corpus): string[] {
  const search = toSearchText(text);
  const named = corpus.recognized.filter((term) =>
    hasWholeToken(search, normalizeMatchPhrase(term)),
  );
  return [...new Set([...techTokens(text), ...named])].filter(
    (token) => !matchesTerm(corpus.search, token),
  );
}

export function droppedTerms(original: string, tailored: string): string[] {
  const tailoredSearchText = toSearchText(tailored);
  const originalSearch = toSearchText(original);
  const named = KNOWN_TERMS.filter((term) =>
    hasWholeToken(originalSearch, normalizeMatchPhrase(term)),
  );
  return [...new Set([...techTokens(original), ...named])].filter(
    (token) => !matchesTerm(tailoredSearchText, token),
  );
}
