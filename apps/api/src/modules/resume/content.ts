import type { ResumeData } from "@openapply/contracts/resume";
import { toInputJson } from "@/common/json";
import type { Prisma } from "@/generated/prisma/client";

function withIds<T extends { id?: string }>(entries: T[], prefix: string): T[] {
  return entries.map((entry) =>
    entry.id ? entry : { ...entry, id: `${prefix}_${crypto.randomUUID()}` },
  );
}

/** Stored content: every entry gets an id, in the web editor's format, whoever wrote it. */
export function toStoredContent(content: ResumeData): Prisma.InputJsonValue {
  return toInputJson({
    ...content,
    experience: withIds(content.experience, "exp"),
    projects: withIds(content.projects, "proj"),
    skills: withIds(content.skills, "skill"),
    education: withIds(content.education, "edu"),
    publications: withIds(content.publications, "pub"),
    awards: withIds(content.awards, "awd"),
    certifications: withIds(content.certifications, "cert"),
    sections: withIds(content.sections, "sec").map((section) => ({
      ...section,
      entries: withIds(section.entries, "ent"),
    })),
  });
}

/** No parse: every write went through `resumeDataSchema`. */
export function readContent(value: Prisma.JsonValue): ResumeData {
  return value as unknown as ResumeData;
}
