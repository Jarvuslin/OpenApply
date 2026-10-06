import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_EVENT_SOURCES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
} from "@jobpilot/contracts/application";
import {
  CAMPAIGN_ACTORS,
  CAMPAIGN_JOB_STATUSES,
  CAMPAIGN_SOURCES,
  CAMPAIGN_STATUSES,
} from "@jobpilot/contracts/campaign";
import { COVER_LETTER_SOURCES } from "@jobpilot/contracts/cover-letter";
import { CLASSIFICATIONS, EMAIL_PROVIDERS, REVIEW_STATUSES } from "@jobpilot/contracts/email";
import { JOB_LEVELS, JOB_LISTING_STATUSES } from "@jobpilot/contracts/job-listing";
import { PILOT_CLAIM_OUTCOMES } from "@jobpilot/contracts/pilot/claim";
import { PILOT_JOURNAL_KINDS } from "@jobpilot/contracts/pilot/journal";
import { PILOT_QUESTION_KINDS, PILOT_QUESTION_STATUSES } from "@jobpilot/contracts/pilot/question";
import { ROLES } from "@jobpilot/contracts/role";
import { AVAILABILITY } from "@jobpilot/contracts/user";
import * as prismaEnums from "@/generated/prisma/enums";
import { describe, expect, it } from "bun:test";

// The web cannot import the generated Prisma client, so `@jobpilot/contracts` keeps its own copy of
// every DB enum's values. This is the only thing stopping the two from drifting.
const PAIRS: [string, readonly string[], Record<string, string>][] = [
  ["JobLevel", JOB_LEVELS, prismaEnums.JobLevel],
  ["ApplicationStatus", APPLICATION_STATUSES, prismaEnums.ApplicationStatus],
  ["ApplicationSource", APPLICATION_SOURCES, prismaEnums.ApplicationSource],
  ["ApplicationEventKind", APPLICATION_EVENT_KINDS, prismaEnums.ApplicationEventKind],
  ["ApplicationEventSource", APPLICATION_EVENT_SOURCES, prismaEnums.ApplicationEventSource],
  ["Availability", AVAILABILITY, prismaEnums.Availability],
  ["CampaignActor", CAMPAIGN_ACTORS, prismaEnums.CampaignActor],
  ["CampaignJobStatus", CAMPAIGN_JOB_STATUSES, prismaEnums.CampaignJobStatus],
  ["CampaignSource", CAMPAIGN_SOURCES, prismaEnums.CampaignSource],
  ["CampaignStatus", CAMPAIGN_STATUSES, prismaEnums.CampaignStatus],

  ["CoverLetterSource", COVER_LETTER_SOURCES, prismaEnums.CoverLetterSource],
  ["EmailClassification", CLASSIFICATIONS, prismaEnums.EmailClassification],
  ["EmailProvider", EMAIL_PROVIDERS, prismaEnums.EmailProvider],
  ["EmailReviewStatus", REVIEW_STATUSES, prismaEnums.EmailReviewStatus],
  ["JobListingStatus", JOB_LISTING_STATUSES, prismaEnums.JobListingStatus],

  ["PilotClaimOutcome", PILOT_CLAIM_OUTCOMES, prismaEnums.PilotClaimOutcome],
  ["PilotJournalKind", PILOT_JOURNAL_KINDS, prismaEnums.PilotJournalKind],
  ["PilotQuestionKind", PILOT_QUESTION_KINDS, prismaEnums.PilotQuestionKind],
  ["PilotQuestionStatus", PILOT_QUESTION_STATUSES, prismaEnums.PilotQuestionStatus],

  ["UserRole", ROLES, prismaEnums.UserRole],
];

describe("contracts enums match the Prisma schema", () => {
  for (const [name, contract, prismaEnum] of PAIRS) {
    it(name, () => {
      expect([...contract].sort()).toEqual(Object.values(prismaEnum).sort());
    });
  }
});
