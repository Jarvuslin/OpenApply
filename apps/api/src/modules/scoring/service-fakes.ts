import { sha256 } from "@/common/crypto/hash";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  CAMPAIGN_ID,
  DESCRIPTION,
  JOB_KEY,
  ORIGINAL_TEXT,
  RESUME_ID,
  scoringContext,
} from "./fakes";
import { OriginalResumeSource } from "./original-source";
import { ScoringService } from "./scoring.service";

export function scoringServiceFixture() {
  const preferences = scoringContext().preferences;
  const state = {
    job: {
      id: "44444444-4444-4444-8444-444444444444",
      campaignId: CAMPAIGN_ID,
      key: JOB_KEY,
      title: "Frontend Engineer",
      company: "Example",
      url: "https://employer.test/job",
      location: "Toronto",
      type: "Full-time",
      description: DESCRIPTION,
      updatedAt: new Date("2026-10-06T12:00:00Z"),
      status: "pending",
      matchScore: null as number | null,
      matchReason: null as string | null,
      fitAssessment: null as unknown,
      campaign: { config: {} as Record<string, unknown>, userId: "u1" },
    },
    user: {
      id: "u1",
      primaryResumeId: RESUME_ID as string | null,
      jobPreferences: preferences.jobPreferences,
      preferredLocations: JSON.stringify(preferences.preferredLocations),
      workAuthorization: preferences.workAuthorization,
      autoApply: { minMatchScore: 60 },
    },
    resume: {
      id: RESUME_ID,
      userId: "u1",
      sourceFilename: "original.txt" as string | null,
      content: { skills: ["Fabricated skill from an accepted rewrite"] },
    },
    sourceText: ORIGINAL_TEXT,
    sourceReads: 0,
    writes: 0,
    resumeSelections: [] as unknown[],
    beforeWrite: null as (() => void) | null,
  };
  const db = {
    job: {
      findFirst: async ({
        where,
      }: {
        where: { campaignId: string; key: string; campaign: { userId: string } };
      }) =>
        where.campaignId === state.job.campaignId &&
        where.key === state.job.key &&
        where.campaign.userId === state.job.campaign.userId
          ? structuredClone(state.job)
          : null,
      findUniqueOrThrow: async () => structuredClone(state.job),
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          updatedAt: Date;
          description: string;
          status: { not: string };
          fitAssessment: { equals: unknown };
          campaign: {
            config: { equals: unknown };
            user: {
              jobPreferences: { equals: unknown };
              workAuthorization: { equals: unknown };
              preferredLocations: string;
              primaryResumeId?: string;
              resumes: { some: { id: string; sourceFilename: string } };
            };
          };
        };
        data: Record<string, unknown>;
      }) => {
        state.beforeWrite?.();
        const user = where.campaign.user;
        const expectedAssessment =
          where.fitAssessment.equals === Prisma.DbNull ? null : where.fitAssessment.equals;
        if (
          state.job.updatedAt.getTime() !== where.updatedAt.getTime() ||
          state.job.status === where.status.not ||
          JSON.stringify(state.job.fitAssessment) !== JSON.stringify(expectedAssessment) ||
          state.job.description !== where.description ||
          JSON.stringify(state.job.campaign.config) !==
            JSON.stringify(where.campaign.config.equals) ||
          JSON.stringify(state.user.jobPreferences) !==
            JSON.stringify(user.jobPreferences.equals) ||
          JSON.stringify(state.user.workAuthorization) !==
            JSON.stringify(user.workAuthorization.equals) ||
          state.user.preferredLocations !== user.preferredLocations ||
          state.resume.id !== user.resumes.some.id ||
          state.resume.sourceFilename !== user.resumes.some.sourceFilename ||
          (user.primaryResumeId !== undefined &&
            state.user.primaryResumeId !== user.primaryResumeId)
        )
          return { count: 0 };
        Object.assign(state.job, data, { updatedAt: new Date(state.job.updatedAt.getTime() + 1) });
        state.writes++;
        return { count: 1 };
      },
    },
    user: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === state.user.id ? structuredClone(state.user) : null,
    },
    resume: {
      findFirst: async ({
        where,
        select,
      }: {
        where: { id: string; userId: string };
        select: unknown;
      }) => {
        state.resumeSelections.push(select);
        return where.id === state.resume.id && where.userId === state.resume.userId
          ? structuredClone(state.resume)
          : null;
      },
    },
  } as unknown as PrismaClient;
  const source = {
    read: async () => {
      state.sourceReads++;
      return { text: state.sourceText, sha256: sha256(state.sourceText) };
    },
  } as OriginalResumeSource;
  return {
    state,
    db,
    service: new ScoringService(db, source),
    request: { campaignId: CAMPAIGN_ID, jobKey: JOB_KEY },
  };
}
