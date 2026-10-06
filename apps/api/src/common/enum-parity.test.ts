import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_EVENT_SOURCES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
} from "@openapply/contracts/application";
import {
  CAMPAIGN_ACTORS,
  CAMPAIGN_JOB_STATUSES,
  CAMPAIGN_SOURCES,
  CAMPAIGN_STATUSES,
} from "@openapply/contracts/campaign";
import { COVER_LETTER_SOURCES } from "@openapply/contracts/cover-letter";
import { CLASSIFICATIONS, EMAIL_PROVIDERS, REVIEW_STATUSES } from "@openapply/contracts/email";
import { JOB_LEVELS, JOB_LISTING_STATUSES } from "@openapply/contracts/job-listing";
import { ATS_PROVIDERS, DISCOVERY_PROVIDERS } from "@openapply/contracts/job-sources";
import { PILOT_CLAIM_OUTCOMES } from "@openapply/contracts/pilot/claim";
import { PILOT_JOURNAL_KINDS } from "@openapply/contracts/pilot/journal";
import { PILOT_QUESTION_KINDS, PILOT_QUESTION_STATUSES } from "@openapply/contracts/pilot/question";
import { ROLES } from "@openapply/contracts/role";
import { AVAILABILITY } from "@openapply/contracts/user";
import * as prismaEnums from "@/generated/prisma/enums";
import { describe, expect, it } from "bun:test";

// The web cannot import the generated Prisma client, so `@openapply/contracts` keeps its own copy of
// every DB enum's values. This is the only thing stopping the two from drifting.
const PAIRS: [string, readonly string[], Record<string, string>][] = [
  ["AtsProvider", ATS_PROVIDERS, prismaEnums.AtsProvider],
  ["DiscoveryProvider", DISCOVERY_PROVIDERS, prismaEnums.DiscoveryProvider],
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
