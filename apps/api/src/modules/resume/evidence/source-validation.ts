import type { ResumeData } from "@openapply/contracts/resume";
import type { CreateResumeEvidence, ResumeEvidence } from "@openapply/contracts/resume-evidence";
import { sha256 } from "@/common/crypto/hash";
import { unprocessable } from "@/common/errors";
import { corpusFromText, extractNumbers, unverifiedTerms } from "../tailoring/facts";
import { unsupportedClaims } from "../tailoring/source-review";

export function evidenceHash(value: unknown): string {
  return sha256(typeof value === "string" ? value : JSON.stringify(value));
}

export function resumeEvidenceText(content: ResumeData, pointer: string): string | null {
  let value: unknown = content;
  for (const key of pointer.slice(1).split("/")) {
    if (!key || key === "id" || !value || typeof value !== "object" || !Object.hasOwn(value, key))
      return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : null;
}

export function validateEvidenceScope(content: ResumeData, scope: string): void {
  if (scope === "general") return;
  const [, section, index] = scope.split("/");
  if ((section !== "experience" && section !== "projects") || !content[section][Number(index)]) {
    throw unprocessable(
      "Evidence scope must identify an existing experience or project in this resume.",
    );
  }
}

export function validateScopedSource(
  content: ResumeData,
  scope: string,
  text: string,
  repository?: string,
): void {
  if (scope === "general") return;
  const [, section, index] = scope.split("/");
  const entry =
    section === "experience" ? content.experience[Number(index)] : content.projects[Number(index)];
  if (repository) {
    const links = [
      ...JSON.stringify(entry).matchAll(
        /https?:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)/gi,
      ),
    ];
    if (
      !links.some(
        (match) => match[1].replace(/\.git$/i, "").toLowerCase() === repository.toLowerCase(),
      )
    ) {
      throw unprocessable(
        "This entry does not link the cited GitHub repository. Keep this evidence general; a personal repository cannot become employer/project experience without confirmed attribution.",
      );
    }
    return;
  }
  const name = "company" in entry ? entry.company : entry.name;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text)) {
    throw unprocessable(
      "Scoped conversation evidence must name the target employer or project in the quoted user statement; otherwise keep it general.",
    );
  }
}

const NON_FACT =
  /\b(?:hypothetical|for example|for instance|imagine|suppose|you could say|you can say|i could claim|if i (?:had|were|built|worked)|let['’]s (?:pretend|assume))\b/i;
const INSTRUCTION =
  /\b(?:ignore (?:all |the )?(?:previous|prior) instructions|system prompt|assistant[,:] (?:write|claim|ignore)|pretend (?:i|you) (?:worked|built|led))\b/i;
const ASSISTANT_SUGGESTION =
  /\b(?:assistant|chatgpt|claude|codex|model)\s+(?:suggested|proposed|recommended|wrote|said|generated)|\b(?:example|sample|suggested|hypothetical)\s+(?:bullet|claim|sentence|resume|resume|experience)|\b(?:suggested phrasing|example wording)\b/i;
const NEGATED = /\b(?:not|never|didn't|didn’t|haven't|haven’t|cannot|can't|can’t|no experience)\b/i;

export function validateEvidenceReview(input: CreateResumeEvidence, text: string): void {
  if (input.status !== "supported") return;
  if (
    input.source.kind === "unverified" ||
    input.review.claimType === "unverified" ||
    input.review.context !== "personal_assertion"
  ) {
    throw unprocessable(
      "Only reviewed personal facts or supported interpretations can be used in a rewrite. Retain other details as unverified optional questions.",
    );
  }
  if (INSTRUCTION.test(text) || INSTRUCTION.test(input.statement)) {
    throw unprocessable("Document instructions are not applicant evidence.");
  }
  if (ASSISTANT_SUGGESTION.test(text) || NON_FACT.test(text) || NEGATED.test(text)) {
    throw unprocessable(
      "Negated, hypothetical or assistant-suggested source material must remain unverified; it cannot establish a positive personal claim.",
    );
  }
  const numbers = extractNumbers(text);
  const added = [...extractNumbers(input.statement)].filter((number) => !numbers.has(number));
  const names = unverifiedTerms(input.statement, corpusFromText(text));
  const claims = unsupportedClaims(input.statement, text);
  const problems = [
    ...(added.length ? [`Unverified measurements: ${added.join(", ")}`] : []),
    ...(names.length ? [`Unverified tools or identities: ${names.join(", ")}`] : []),
    ...claims,
  ];
  if (problems.length)
    throw unprocessable("Evidence statement is not supported by its quoted source.", problems);
}

export function githubLogin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length === 1 && /^[A-Za-z0-9-]+$/.test(segments[0]) ? segments[0] : null;
  } catch {
    return null;
  }
}

export interface GithubCommit {
  sha: string;
  author: { login: string } | null;
  files?: { filename: string; patch?: string }[];
}

export function validateGithubContribution(
  source: Extract<CreateResumeEvidence["source"], { kind: "github" }>,
  commit: GithubCommit,
  login: string,
): Omit<ResumeEvidence["verification"], "resumeVersion" | "scopeSha256"> {
  if (
    commit.sha !== source.commitSha ||
    commit.author?.login.toLowerCase() !== login.toLowerCase()
  ) {
    throw unprocessable(
      "GitHub evidence needs a commit authored by the applicant-linked GitHub identity; repository ownership is insufficient.",
    );
  }
  const file = commit.files?.find((candidate) => candidate.filename === source.path);
  const additions = file?.patch
    ?.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  if (!additions?.includes(source.quote)) {
    throw unprocessable(
      "GitHub evidence must quote added lines in the applicant-authored commit's changed file. Missing/truncated patches remain unverified.",
    );
  }
  return {
    sourceSha256: evidenceHash({
      repository: source.repository,
      commitSha: commit.sha,
      author: commit.author,
      path: file?.filename,
      additions,
    }),
    sourceRecord: `${source.repository}@${commit.sha}:${source.path}`,
    sourceUrl: `https://github.com/${source.repository}/blob/${commit.sha}/${source.path.split("/").map(encodeURIComponent).join("/")}`,
    authorLogin: commit.author?.login ?? null,
    limitation:
      "Commit association and added source lines support attributable contribution; they do not prove sole authorship, production deployment, employment, adoption or outcomes. Semantic support remains an agent judgment.",
  };
}
