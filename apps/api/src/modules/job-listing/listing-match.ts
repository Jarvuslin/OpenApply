import { sha256 } from "@/common/crypto/hash";
import { normalizePhrase } from "@/modules/scoring/keyword-normalize";
import { normalizeListingLocation } from "./dedupe";

/** Fuzzy matching only merges when every signal agrees; any missing signal means no merge. */
const MAX_DAYS_APART = 14;
const MIN_DESCRIPTION_SIMILARITY = 0.8;
const DAY = 86_400_000;

/** Same normalized title in the same place: with the company, the only listings fuzzy compares. */
export function matchKey(title: string, location: string | null | undefined): string {
  return sha256(`${normalizePhrase(title)}|${normalizeListingLocation(location)}`);
}

export interface SourceIdentity {
  boardKey: string | null;
  externalId: string | null;
}

/** Two different ids on the same board are two postings, whatever else they share. */
export function boardConflict(a: SourceIdentity[], b: SourceIdentity[]): boolean {
  return a.some((left) =>
    b.some(
      (right) =>
        !!left.boardKey &&
        left.boardKey === right.boardKey &&
        !!left.externalId &&
        !!right.externalId &&
        left.externalId !== right.externalId,
    ),
  );
}

function shingles(text: string): Set<string> {
  const words = normalizePhrase(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let index = 0; index + 3 <= words.length; index++)
    out.add(words.slice(index, index + 3).join(" "));
  return out;
}

/** Share of three-word runs the two texts have in common. */
export function descriptionSimilarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const shingle of left) if (right.has(shingle)) shared++;
  return shared / Math.min(left.size, right.size);
}

export interface FuzzyCandidate {
  postedAt: Date | null;
  description: string | null;
  sources: SourceIdentity[];
}

/** Callers pass only listings of one company with the same `matchKey`. */
export function fuzzyMatch(a: FuzzyCandidate, b: FuzzyCandidate): boolean {
  if (!a.postedAt || !b.postedAt) return false;
  if (Math.abs(a.postedAt.getTime() - b.postedAt.getTime()) > MAX_DAYS_APART * DAY) return false;
  if (!a.description || !b.description) return false;
  if (descriptionSimilarity(a.description, b.description) < MIN_DESCRIPTION_SIMILARITY)
    return false;
  return !boardConflict(a.sources, b.sources);
}
