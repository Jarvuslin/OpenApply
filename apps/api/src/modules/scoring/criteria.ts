import type { FitContext } from "@openapply/contracts/scoring";
import { sha256 } from "@/common/crypto/hash";
import { unprocessable } from "@/common/errors";

type Criterion = FitContext["job"]["criteria"][number];
type Section = Criterion["section"];
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

function heading(text: string): Section | null {
  const plain = text
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/[:\s]+$/, "")
    .trim();
  if (plain.length > 100) return null;
  if (
    /^(?:(?:minimum|required|preferred|basic|essential|desired)\s+)?(?:qualifications|requirements|skills)(?:\s+(?:and|&)\s+(?:experience|qualifications|skills))?$|^(?:what (?:you bring|we(?:'|’)re looking for|we look for)|about you|you (?:have|bring)|your (?:skills|qualifications))$/i.test(
      plain,
    )
  )
    return "requirements";
  if (
    /^(?:(?:(?:key|core|your|job)\s+)?(?:responsibilities|duties)|what you(?:'|’)ll do|what you will do|your impact|the role|about the role|in this role)$/i.test(
      plain,
    )
  )
    return "responsibilities";
  if (
    /^(?:about us|about the company|who we are|benefits|compensation|what we offer|equal opportunity|how to apply|our (?:team|culture))$/i.test(
      plain,
    )
  )
    return "other";
  return null;
}

/** Preserve exact source offsets, including prose outside familiar ATS section headings. */
export function jobCriteria(description: string, title: string, company: string): Criterion[] {
  if (description.trim().length < 200 || description.trim().split(/\s+/).length < 30) {
    throw unprocessable(
      "Save the complete live job description, including requirements and responsibilities, before scoring; the saved description is too thin.",
    );
  }
  if (description.length > 200_000)
    throw unprocessable("Job description exceeds 200,000 characters; it was not truncated.");
  const result: Criterion[] = [];
  let section: Section = "other";
  const add = (raw: string, offset: number, isHeading: boolean) => {
    const text = raw.trim();
    if (!text) return;
    const start = offset + raw.indexOf(text);
    const end = start + text.length;
    result.push({
      id: `c${result.length + 1}-${sha256(`${start}:${end}:${text}`).slice(0, 12)}`,
      start,
      end,
      text,
      section,
      isHeading,
    });
  };
  for (const line of description.matchAll(/[^\r\n]+/g)) {
    const raw = line[0];
    const text = raw.trim();
    if (!text) continue;
    const next = heading(text);
    if (next !== null || text === title || text === company) {
      section = next ?? "other";
      add(raw, line.index, true);
      continue;
    }
    for (const sentence of sentences.segment(raw))
      add(sentence.segment, line.index + sentence.index, false);
  }
  if (result.length > 500)
    throw unprocessable(
      "Job description has more than 500 assessment units; no units were dropped.",
    );
  return result;
}
