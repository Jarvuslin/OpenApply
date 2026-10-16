import { conflict } from "@/common/errors";
import { Prisma } from "@/generated/prisma/client";

interface SourceState {
  id: string;
  userId: string;
  version: number;
  sourceFilename: string | null;
  content: unknown;
  _count: { variants: number; applications: number };
}

export function sourceReplacementWhere(resume: SourceState): Prisma.ResumeWhereInput {
  if (resume.content !== null || resume._count.variants > 0 || resume._count.applications > 0) {
    throw conflict(
      "This resume has extracted content, variants or applications. Upload a new resume in Documents to keep its original and saved versions intact.",
    );
  }
  return {
    id: resume.id,
    userId: resume.userId,
    version: resume.version,
    sourceFilename: resume.sourceFilename,
    content: { equals: Prisma.DbNull },
    variants: { none: {} },
    applications: { none: {} },
  };
}
