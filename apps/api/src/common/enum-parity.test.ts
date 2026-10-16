import { AGENT_EVENT_KINDS, AGENT_PROVIDERS } from "@openapply/contracts/agent";
import { BANK_REVISION_ACTIONS, BANK_SCOPES } from "@openapply/contracts/answer-bank-input";
import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_EVENT_SOURCES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
} from "@openapply/contracts/application";
import {
  PREPARATION_MODES,
  PREPARATION_STATUSES,
} from "@openapply/contracts/application-preparation";
import {
  QUESTION_AUTHORSHIPS,
  QUESTION_CATEGORIES,
  QUESTION_COVERAGES,
  QUESTION_REQUIREMENTS,
  QUESTION_SOURCES,
  QUESTION_VISIBILITIES,
} from "@openapply/contracts/application-question";
import {
  CAMPAIGN_ACTORS,
  CAMPAIGN_JOB_STATUSES,
  CAMPAIGN_SOURCES,
  CAMPAIGN_STATUSES,
} from "@openapply/contracts/campaign";
import { CHECKPOINT_DECISIONS } from "@openapply/contracts/checkpoint-approval";
import { COVER_LETTER_SOURCES } from "@openapply/contracts/cover-letter";
import {
  CLASSIFICATIONS,
  EMAIL_PROVIDERS,
  EMAIL_RUNTIME_PROVIDERS,
  REVIEW_STATUSES,
} from "@openapply/contracts/email";
import { INTAKE_DECISIONS } from "@openapply/contracts/job-intake";
import {
  JOB_EMPLOYMENT_TYPES,
  JOB_LEVELS,
  JOB_LISTING_STATUSES,
  JOB_SALARY_PERIODS,
  JOB_WORK_MODES,
} from "@openapply/contracts/job-listing";
import { ATS_PROVIDERS, DISCOVERY_PROVIDERS } from "@openapply/contracts/job-sources";
import {
  LEGACY_EMPLOYER_ACCOUNT_MODES,
  LEGACY_EMPLOYER_ACCOUNT_REASONS,
  LEGACY_EMPLOYER_ACCOUNT_STATES,
} from "@openapply/contracts/legacy-employer-account";
import { LEGACY_TELEGRAM_DELIVERY_STATUSES } from "@openapply/contracts/legacy-telegram";
import { LINKEDIN_RUN_STATUSES } from "@openapply/contracts/linkedin-discovery";
import { PILOT_JOURNAL_KINDS } from "@openapply/contracts/pilot/journal";
import { PILOT_QUESTION_KINDS, PILOT_QUESTION_STATUSES } from "@openapply/contracts/pilot/question";
import {
  PILOT_MATCH_MODES,
  PILOT_RESULT_STATUSES,
  PILOT_RUN_STATES,
  PILOT_RUN_TRIGGERS,
} from "@openapply/contracts/pilots";
import { RESUME_EVIDENCE_STATUSES } from "@openapply/contracts/resume-evidence";
import { ROLES } from "@openapply/contracts/role";
import { RUNTIME_BLOCKING_CODES, RUNTIME_STATES } from "@openapply/contracts/runtime-presence";
import {
  EVALUATION_COHORTS,
  EVALUATION_FAILURES,
  EVALUATION_MODELS,
  EVALUATION_ORIGINS,
  EVALUATION_SLOTS,
  EVALUATION_STATUSES,
} from "@openapply/contracts/scoring-evaluation";
import {
  TELEGRAM_ACTION_KINDS,
  TELEGRAM_ACTION_STATES,
  TELEGRAM_DELIVERY_FAILURES,
  TELEGRAM_DELIVERY_STATES,
  TELEGRAM_SENDER_EVENT_KINDS,
  TELEGRAM_TEMPLATE_KINDS,
  TELEGRAM_UPDATE_STATES,
} from "@openapply/contracts/telegram";
import { AVAILABILITY } from "@openapply/contracts/user";
import {
  WORK_INTENTS,
  WORK_KINDS,
  WORK_SOURCES,
  WORK_STATES,
} from "@openapply/contracts/work-queue";
import * as prismaEnums from "@/generated/prisma/enums";
import { describe, expect, it } from "bun:test";

// The web cannot import the generated Prisma client, so `@openapply/contracts` keeps its own copy of
// every DB enum's values. This is the only thing stopping the two from drifting.
const PAIRS: [string, readonly string[], Record<string, string>][] = [
  ["EmployerAccountMode", LEGACY_EMPLOYER_ACCOUNT_MODES, prismaEnums.EmployerAccountMode],
  ["EmployerAccountState", LEGACY_EMPLOYER_ACCOUNT_STATES, prismaEnums.EmployerAccountState],
  ["EmployerAccountReason", LEGACY_EMPLOYER_ACCOUNT_REASONS, prismaEnums.EmployerAccountReason],
  [
    "LegacyTelegramDeliveryStatus",
    LEGACY_TELEGRAM_DELIVERY_STATUSES,
    prismaEnums.LegacyTelegramDeliveryStatus,
  ],
  ["IntakeDecision", INTAKE_DECISIONS, prismaEnums.IntakeDecision],
  ["CheckpointDecision", CHECKPOINT_DECISIONS, prismaEnums.CheckpointDecision],
  ["RuntimeState", RUNTIME_STATES, prismaEnums.RuntimeState],
  ["RuntimeBlockingCode", RUNTIME_BLOCKING_CODES, prismaEnums.RuntimeBlockingCode],
  ["TelegramUpdateState", TELEGRAM_UPDATE_STATES, prismaEnums.TelegramUpdateState],
  ["TelegramActionKind", TELEGRAM_ACTION_KINDS, prismaEnums.TelegramActionKind],
  ["TelegramActionState", TELEGRAM_ACTION_STATES, prismaEnums.TelegramActionState],
  ["TelegramDeliveryState", TELEGRAM_DELIVERY_STATES, prismaEnums.TelegramDeliveryState],
  ["TelegramTemplateKind", TELEGRAM_TEMPLATE_KINDS, prismaEnums.TelegramTemplateKind],
  ["TelegramDeliveryFailure", TELEGRAM_DELIVERY_FAILURES, prismaEnums.TelegramDeliveryFailure],
  ["TelegramSenderEventKind", TELEGRAM_SENDER_EVENT_KINDS, prismaEnums.TelegramSenderEventKind],
  ["ScoringEvaluationOrigin", EVALUATION_ORIGINS, prismaEnums.ScoringEvaluationOrigin],
  ["ScoringEvaluationSlot", EVALUATION_SLOTS, prismaEnums.ScoringEvaluationSlot],
  ["ScoringEvaluationStatus", EVALUATION_STATUSES, prismaEnums.ScoringEvaluationStatus],
  ["ScoringEvaluationCohort", EVALUATION_COHORTS, prismaEnums.ScoringEvaluationCohort],
  ["ScoringEvaluationModel", EVALUATION_MODELS, prismaEnums.ScoringEvaluationModel],
  ["ScoringEvaluationFailure", EVALUATION_FAILURES, prismaEnums.ScoringEvaluationFailure],
  ["PreparationMode", PREPARATION_MODES, prismaEnums.PreparationMode],
  ["PreparationStatus", PREPARATION_STATUSES, prismaEnums.PreparationStatus],
  ["AnswerBankScope", BANK_SCOPES, prismaEnums.AnswerBankScope],
  ["AnswerBankAction", BANK_REVISION_ACTIONS, prismaEnums.AnswerBankAction],
  ["QuestionSource", QUESTION_SOURCES, prismaEnums.QuestionSource],
  ["QuestionCoverage", QUESTION_COVERAGES, prismaEnums.QuestionCoverage],
  ["QuestionCategory", QUESTION_CATEGORIES, prismaEnums.QuestionCategory],
  ["QuestionRequirement", QUESTION_REQUIREMENTS, prismaEnums.QuestionRequirement],
  ["QuestionVisibility", QUESTION_VISIBILITIES, prismaEnums.QuestionVisibility],
  ["QuestionAuthorship", QUESTION_AUTHORSHIPS, prismaEnums.QuestionAuthorship],
  ["WorkKind", WORK_KINDS, prismaEnums.WorkKind],
  ["WorkState", WORK_STATES, prismaEnums.WorkState],
  ["WorkSource", WORK_SOURCES, prismaEnums.WorkSource],
  ["WorkIntent", WORK_INTENTS, prismaEnums.WorkIntent],
  ["PilotMatchMode", PILOT_MATCH_MODES, prismaEnums.PilotMatchMode],
  ["PilotRunTrigger", PILOT_RUN_TRIGGERS, prismaEnums.PilotRunTrigger],
  ["PilotRunState", PILOT_RUN_STATES, prismaEnums.PilotRunState],
  ["PilotResultStatus", PILOT_RESULT_STATUSES, prismaEnums.PilotResultStatus],
  ["ResumeEvidenceStatus", RESUME_EVIDENCE_STATUSES, prismaEnums.ResumeEvidenceStatus],
  ["AgentProvider", AGENT_PROVIDERS, prismaEnums.AgentProvider],
  ["AgentEventKind", AGENT_EVENT_KINDS, prismaEnums.AgentEventKind],
  ["AtsProvider", ATS_PROVIDERS, prismaEnums.AtsProvider],
  ["DiscoveryProvider", DISCOVERY_PROVIDERS, prismaEnums.DiscoveryProvider],
  ["LinkedinDiscoveryRunStatus", LINKEDIN_RUN_STATUSES, prismaEnums.LinkedinDiscoveryRunStatus],
  ["JobLevel", JOB_LEVELS, prismaEnums.JobLevel],
  ["JobWorkMode", JOB_WORK_MODES, prismaEnums.JobWorkMode],
  ["JobEmploymentType", JOB_EMPLOYMENT_TYPES, prismaEnums.JobEmploymentType],
  ["JobSalaryPeriod", JOB_SALARY_PERIODS, prismaEnums.JobSalaryPeriod],
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
  ["EmailRuntimeProvider", EMAIL_RUNTIME_PROVIDERS, prismaEnums.EmailRuntimeProvider],
  ["EmailReviewStatus", REVIEW_STATUSES, prismaEnums.EmailReviewStatus],
  ["JobListingStatus", JOB_LISTING_STATUSES, prismaEnums.JobListingStatus],

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
