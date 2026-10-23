import { campaignConfigSchema } from "@openapply/contracts/campaign";
import {
  FIT_RUBRIC_VERSION,
  type FitAssessment,
  type FitContext,
  fitAssessmentSchema,
  type ScoreAssessmentInput,
  type ScoreContextInput,
} from "@openapply/contracts/scoring";
import {
  DEFAULT_MIN_MATCH_SCORE,
  jobPreferencesSchema,
  workAuthorizationSchema,
} from "@openapply/contracts/user";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { sha256 } from "@/common/crypto/hash";
import { conflict, findOwned, HttpError, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { assessFit, sameBasis } from "./assessment";
import { jobCriteria } from "./criteria";
import { OriginalResumeSource } from "./original-source";

type ScoringDatabase = Pick<PrismaClient, "job" | "user" | "resume">;

@singleton()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: OriginalResumeSource,
  ) {}

  private async loadContext(
    userId: string,
    input: ScoreContextInput,
    db: ScoringDatabase = this.prisma,
    requirePosting = true,
  ) {
    const job = await findOwned(
      (where) => db.job.findFirst({ where, include: { campaign: { select: { config: true } } } }),
      { campaignId: input.campaignId, key: input.jobKey, campaign: { userId } },
      "Campaign job",
    );
    const user = await findOwned(
      (where) =>
        db.user.findFirst({
          where,
          select: {
            primaryResumeId: true,
            jobPreferences: true,
            preferredLocations: true,
            workAuthorization: true,
            autoApply: { select: { minMatchScore: true } },
          },
        }),
      { id: userId },
      "User",
    );
    const config = campaignConfigSchema.parse(job.campaign.config);
    const resumeId = input.resumeId ?? config.resumeId ?? user.primaryResumeId;
    if (!resumeId) throw unprocessable("Choose an original uploaded resume before scoring.");
    const resume = await findOwned(
      (where) => db.resume.findFirst({ where, select: { id: true, sourceFilename: true } }),
      { id: resumeId, userId },
      "Original resume",
    );
    if (!resume.sourceFilename)
      throw unprocessable(
        "Scoring requires an original uploaded resume; edited content and tailored variants are not scoring sources.",
      );
    const description = job.description ?? "";
    const criteria = requirePosting ? jobCriteria(description, job.title, job.company) : [];
    const source = await this.sources.read(resume.sourceFilename);
    const saved = jobPreferencesSchema.parse(user.jobPreferences);
    const preferences: FitContext["preferences"] = {
      jobPreferences: {
        ...saved,
        roles: [...saved.roles].sort(),
        levels: [...saved.levels].sort(),
        workModes: [...saved.workModes].sort(),
        employmentTypes: [...saved.employmentTypes].sort(),
      },
      preferredLocations: z.array(z.string()).parse(JSON.parse(user.preferredLocations)).sort(),
      workAuthorization: workAuthorizationSchema
        .parse(user.workAuthorization)
        .sort((a, b) => a.country.localeCompare(b.country)),
    };
    const jobSource = {
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.location,
      type: job.type,
      description,
    };
    const basis: FitAssessment["basis"] = {
      version: FIT_RUBRIC_VERSION,
      resumeId: resume.id,
      sourceSha256: source.sha256,
      sourceTextSha256: sha256(source.text),
      jobSha256: sha256(JSON.stringify(jobSource)),
      preferencesSha256: sha256(JSON.stringify(preferences)),
    };
    const cached = fitAssessmentSchema.safeParse(job.fitAssessment);
    // A rubric release never invalidates unchanged saved judgments or schedules an implicit rescore.
    if (
      cached.success &&
      sameBasis(cached.data.basis, { ...basis, version: cached.data.basis.version })
    )
      basis.version = cached.data.basis.version;
    const context: FitContext = {
      basis,
      job: { ...jobSource, criteria },
      resume: { text: source.text },
      preferences,
      minMatchScore: config.minScore ?? user.autoApply?.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE,
      cachedAssessment: cached.success && sameBasis(cached.data.basis, basis) ? cached.data : null,
    };
    return { context, job, user, resume, config };
  }

  async context(
    userId: string,
    input: ScoreContextInput,
    db: ScoringDatabase = this.prisma,
  ): Promise<FitContext> {
    return (await this.loadContext(userId, input, db)).context;
  }

  async preparationContext(userId: string, input: ScoreContextInput, db: ScoringDatabase) {
    return (await this.loadContext(userId, input, db, false)).context;
  }

  async currentAssessment(
    userId: string,
    input: ScoreContextInput,
    db: ScoringDatabase = this.prisma,
  ): Promise<FitAssessment | null> {
    try {
      return (await this.loadContext(userId, input, db)).context.cachedAssessment;
    } catch (error) {
      if (error instanceof HttpError && [404, 422].includes(error.status)) return null;
      throw error;
    }
  }

  async scoreJobFit(
    userId: string,
    input: ScoreAssessmentInput,
    db: ScoringDatabase = this.prisma,
  ): Promise<FitAssessment> {
    const { context, job, user, resume, config } = await this.loadContext(userId, input, db);
    if (!sameBasis(input.basis, context.basis))
      throw conflict(
        "Scoring inputs changed. Read a fresh scoring context before assessing this job.",
      );
    // A retry can retrieve an assessment, but cannot replace its judgments to inflate the score.
    if (context.cachedAssessment) return context.cachedAssessment;
    if (config.discovery && !input.preferenceChecks)
      throw unprocessable(
        "Profile discovery requires separate preference and eligibility checks before saving a score.",
      );
    if (job.status === "applied")
      throw conflict("An applied job's historical fit assessment cannot be replaced.");
    const assessment = assessFit(context, input);
    const userWhere: Prisma.UserWhereInput = {
      id: userId,
      jobPreferences: { equals: user.jobPreferences as Prisma.InputJsonValue },
      workAuthorization: { equals: user.workAuthorization as Prisma.InputJsonValue },
      preferredLocations: user.preferredLocations,
      resumes: { some: { id: resume.id, sourceFilename: resume.sourceFilename } },
      ...(!input.resumeId && !config.resumeId && { primaryResumeId: user.primaryResumeId }),
    };
    const changed = await db.job.updateMany({
      where: {
        id: job.id,
        status: { not: "applied" },
        updatedAt: job.updatedAt,
        description: job.description,
        fitAssessment: {
          equals:
            job.fitAssessment === null
              ? Prisma.DbNull
              : (job.fitAssessment as Prisma.InputJsonValue),
        },
        campaign: {
          user: userWhere,
          config: { equals: job.campaign.config as Prisma.InputJsonValue },
        },
      },
      data: {
        fitAssessment: toInputJson(assessment),
        matchScore: assessment.score,
        matchReason: assessment.matchReason,
      },
    });
    if (changed.count !== 1) {
      const winner = await this.currentAssessment(userId, input, db);
      if (winner) return winner;
      throw conflict(
        "The job, original resume or preferences changed while scoring. Read a fresh scoring context.",
      );
    }
    const updated = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    publishJob(userId, updated, "updated");
    return assessment;
  }
}
