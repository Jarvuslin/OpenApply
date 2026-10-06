import { jobPreferencesSchema, workAuthorizationSchema } from "@openapply/contracts/user";
import { Country } from "country-state-city";
import { singleton } from "tsyringe";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { readContent } from "@/modules/resume/content";
import { type FitResult, scoreFit } from "./fit";
import { deriveProfileFitInputs } from "./profile-fit";
import type { FitProfile, JobDigest } from "./scoring.schema";

interface ScoreJobFitInput {
  digest: JobDigest;
  profile?: Partial<FitProfile>;
  resumeId?: string;
  minScore?: number;
}

@singleton()
export class ScoringService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Loads the profile's primary resume, derives fit inputs from it, merges any
   * caller-provided profile overrides, and scores the job digest.
   */
  async scoreJobFit(
    userId: string,
    { digest, profile, resumeId, minScore }: ScoreJobFitInput,
  ): Promise<FitResult> {
    // Prefer an explicit, owned resume override; otherwise the user's primary.
    const [content, user] = await Promise.all([
      this.resolveBaseResumeContent(userId, resumeId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          jobPreferences: true,
          workAuthorization: true,
          autoApply: { select: { minMatchScore: true } },
        },
      }),
    ]);

    let derived = { skills: [] as string[], yearsExperience: null as number | null };

    if (content !== null) {
      derived = deriveProfileFitInputs(readContent(content));
    }

    const preferences = user ? jobPreferencesSchema.parse(user.jobPreferences) : null;
    const authorization = user ? workAuthorizationSchema.parse(user.workAuthorization) : [];
    const country = Country.getAllCountries().find(
      (c) => c.isoCode === digest.country || c.name === digest.country,
    );
    const scoped = country
      ? authorization.find((a) => a.country === country.name || a.country === country.isoCode)
      : undefined;
    const fitProfile = {
      skills: profile?.skills ?? derived.skills,
      yearsExperience:
        profile?.yearsExperience !== undefined
          ? profile.yearsExperience
          : (preferences?.yearsExperience ?? derived.yearsExperience),
      // Unknown country eligibility must be confirmed during apply, not turned into a global rejection.
      requiresSponsorship: scoped?.sponsorship === true,
    };

    // A caller that omits the threshold gets the user's own auto-apply bar, not a global constant.
    return scoreFit(digest, fitProfile, minScore ?? user?.autoApply?.minMatchScore);
  }

  /**
   * Resolve the scoring base resume's content in a single query per path: an
   * owned `resumeId` override, else the user's primary (via relation).
   */
  private async resolveBaseResumeContent(
    userId: string,
    resumeId?: string,
  ): Promise<Prisma.JsonValue> {
    if (resumeId) {
      const override = await this.prisma.resume.findFirst({
        where: { id: resumeId, userId },
        select: { content: true },
      });
      if (override) return override.content;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { primaryResume: { select: { content: true } } },
    });
    return user?.primaryResume?.content ?? null;
  }
}
