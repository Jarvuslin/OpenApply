import { resumeDataSchema } from "@openapply/contracts/resume";
import type { CreateResumeEvidence, ResumeEvidence } from "@openapply/contracts/resume-evidence";
import type { PrismaClient } from "@/generated/prisma/client";
import { ResumeEvidenceService } from "./resume-evidence.service";
export const userId = "10000000-0000-4000-8000-000000000001";
export const resumeId = "10000000-0000-4000-8000-000000000002";
const evidenceId = "10000000-0000-4000-8000-000000000004";
export const now = new Date("2026-10-07T12:00:00.000Z");

export function fixture() {
  const base = {
    id: resumeId,
    userId,
    version: 3,
    content: resumeDataSchema.parse({
      basics: { name: "Applicant" },
      experience: [
        {
          company: "North",
          title: "Engineer",
          start: "2025",
          bullets: ["Built APIs using TypeScript."],
        },
      ],
    }),
  };
  const user = { id: userId, city: "Toronto", github: "https://github.com/applicant" };
  const rows: ResumeEvidence[] = [];
  const matches = (row: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const record = row as Record<string, unknown>;
      if (
        key === "id" &&
        value &&
        typeof value === "object" &&
        "in" in value &&
        Array.isArray(value.in)
      )
        return value.in.includes(record.id);
      return record[key] === value;
    });
  const db = {
    resume: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        matches(base, where) ? base : null,
    },
    user: { findUnique: async () => user },
    resumeEvidence: {
      create: async ({
        data,
      }: {
        data: Omit<ResumeEvidence, "id" | "revision" | "createdAt" | "updatedAt">;
      }) => {
        const row = { id: evidenceId, revision: 1, createdAt: now, updatedAt: now, ...data };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, where)),
      count: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, where)).length,
      updateManyAndReturn: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Omit<ResumeEvidence, "revision">> & { revision: { increment: number } };
      }) =>
        rows
          .filter((row) => matches(row, where))
          .map((row) => {
            Object.assign(row, { ...data, revision: row.revision + data.revision.increment });
            return row;
          }),
    },
  };
  return {
    service: new ResumeEvidenceService(db as unknown as PrismaClient),
    rows,
    base,
    user,
  };
}

export function input(): CreateResumeEvidence {
  return {
    statement: "Built APIs using TypeScript.",
    scope: "/experience/0",
    status: "supported",
    source: {
      kind: "resume",
      version: 3,
      path: "/experience/0/bullets/0",
      quote: "Built APIs using TypeScript.",
    },
    review: {
      claimType: "explicit",
      context: "personal_assertion",
      rationale: "The exact original bullet supports this work at North.",
    },
  };
}
