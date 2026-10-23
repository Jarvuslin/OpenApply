import type { ResumeData } from "@openapply/contracts/resume";
import { sha256 } from "@/common/crypto/hash";
import { CANONICAL_PREAMBLE } from "./canonical-preamble";

const ESCAPES: Record<string, string> = {
  "\\": "{\\fontencoding{T1}\\selectfont\\textbackslash}",
  "{": "\\{",
  "}": "\\}",
  $: "\\char36{}",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  _: "{\\fontencoding{T1}\\selectfont\\textunderscore}",
  "~": "{\\fontencoding{T1}\\selectfont\\textasciitilde}",
  "^": "{\\fontencoding{T1}\\selectfont\\textasciicircum}",
  "–": "--",
  "—": "---",
  "‘": "`",
  "’": "'",
  "“": "``",
  "”": "''",
};

function escapeTex(value: string): string {
  if (
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new Error("Resume text contains unsupported control characters.");
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\{}$&#%_~^–—‘’“”]/g, (char) => ESCAPES[char]);
}

function escapeHref(value: string): string {
  return value.replace(/[\\{}%#&_]/g, (char) => `\\${char}`);
}

export function dateRange(start?: string, end?: string): string {
  return [start?.trim(), end?.trim()].filter(Boolean).join(" – ");
}

export function buildResumeTex(data: ResumeData): { tex: string; expectedText: string[] } {
  const expectedText: string[] = [];
  function text(value?: string | null): string {
    if (!value?.trim()) return "";
    expectedText.push(value.trim());
    return escapeTex(value);
  }
  function link(value?: string): string {
    if (!value?.trim()) return "";
    const raw = value.trim();
    const url = new URL(/^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Resume links must use HTTP or HTTPS without credentials.");
    return `\\href{${escapeHref(url.href)}}{${text(raw.replace(/^https?:\/\//, ""))}}`;
  }
  function bullets(values: string[]): string {
    const items = values.filter((value) => value.trim());
    if (!items.length) return "";
    return `\\resumeItemListStart\n${items.map((value) => `\\resumeItem{${text(value)}}`).join("\n")}\n\\resumeItemListEnd`;
  }
  function heading(title: string, dates = "", sub = "", location = ""): string {
    return `\\resumeSubheading{${text(title)}}{${text(dates)}}{${text(sub)}}{${text(location)}}`;
  }
  function section(title: string, entries: string[]): string {
    if (!entries.length) return "";
    return `\\section{${text(title)}}\n\\resumeSubHeadingListStart\n${entries.join("\n")}\n\\resumeSubHeadingListEnd`;
  }
  const name = text(data.basics.name);
  if (!name) throw new Error("Resume name is required before rendering.");
  const contacts = [
    text(data.basics.phone),
    data.basics.email
      ? `\\href{mailto:${escapeHref(data.basics.email)}}{${text(data.basics.email)}}`
      : "",
    link(data.basics.github),
    link(data.basics.linkedin),
    link(data.basics.website),
    text(data.basics.location),
  ].filter(Boolean);
  const header = `\\begin{center}\n{\\Huge \\scshape ${name}} \\\\ \\vspace{2pt}\n${data.basics.headline ? `\\small ${text(data.basics.headline)} \\\\` : ""}\n\\small ${contacts.join(" $|$ ")}\n\\end{center}\n\\vspace{-6pt}`;
  const summary = data.summary?.trim() ? `\\small{${text(data.summary)}}\n\\vspace{-4pt}` : "";
  const education = section(
    "Education",
    data.education.map(
      (entry) =>
        `${heading(entry.school, dateRange(entry.start, entry.end), entry.degree, entry.location)}\n${bullets([...entry.details, ...(entry.bullets ?? [])])}`,
    ),
  );
  const experience = section(
    "Experience",
    data.experience.map(
      (entry) =>
        `${heading(entry.company, [dateRange(entry.start, entry.end), entry.dateNote].filter(Boolean).join(" — "), entry.title, entry.location)}\n${bullets(entry.bullets)}`,
    ),
  );
  const projects = section(
    "Projects",
    data.projects.map((entry) => {
      const title = `\\textbf{${text(entry.name)}}${entry.keywords.length ? ` $|$ \\emph{${text(entry.keywords.join(", "))}}` : ""}`;
      const row = `\\resumeProjectHeading{${title}}{${text(dateRange(entry.start, entry.end))}}`;
      const url = link(entry.url);
      return `${row}\n${url ? `\\small{${url}}` : ""}\n${bullets([...(entry.description ? [entry.description] : []), ...entry.bullets])}`;
    }),
  );
  const skills = data.skills.length
    ? `\\section{${text("Technical Skills")}}\n\\begin{itemize}[leftmargin=0.15in, label={}]\n\\small{\\item{\n${data.skills.map((group) => `\\textbf{${text(group.group)}}{: ${text(group.items.join(", "))}}`).join(" \\\\\n")}\n}}\n\\end{itemize}`
    : "";
  const publications = section(
    "Publications",
    data.publications.map(
      (entry) =>
        `${heading(entry.title, entry.year, [entry.authors, entry.venue].filter(Boolean).join(" · "))}\n${bullets(entry.doi ? [`DOI: ${entry.doi}`] : [])}\n${link(entry.url)}`,
    ),
  );
  const awards = section(
    "Awards & Honors",
    data.awards.map(
      (entry) =>
        `${heading(entry.title, entry.year, entry.issuer)}\n${bullets(entry.description ? [entry.description] : [])}`,
    ),
  );
  const certifications = section(
    "Certifications",
    data.certifications.map(
      (entry) =>
        `${heading(entry.name, dateRange(entry.issued, entry.expires), entry.issuer)}\n${bullets(entry.credentialId ? [`Credential ID: ${entry.credentialId}`] : [])}\n${link(entry.url)}`,
    ),
  );
  const extras = data.sections.map((extra) =>
    section(
      extra.title,
      extra.entries.map(
        (entry) =>
          `${heading(entry.heading, entry.meta, entry.subheading)}\n${bullets(entry.bullets)}`,
      ),
    ),
  );
  const tex = [
    CANONICAL_PREAMBLE,
    "\\begin{document}",
    header,
    "\\small",
    summary,
    education,
    experience,
    projects,
    skills,
    publications,
    awards,
    certifications,
    ...extras,
    "\\end{document}",
    "",
  ]
    .filter((value) => value !== "")
    .join("\n");
  if (tex.length > 150_000)
    throw new Error("Resume content is too large to render safely; no content was dropped.");
  return { tex, expectedText };
}

export const RESUME_TEMPLATE = {
  id: "openapply-canonical",
  version: "1",
  sha256: sha256(
    [
      CANONICAL_PREAMBLE,
      JSON.stringify(ESCAPES),
      escapeTex.toString(),
      escapeHref.toString(),
      dateRange.toString(),
      buildResumeTex.toString(),
    ].join("\n"),
  ),
};
