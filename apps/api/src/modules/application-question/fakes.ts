import type {
  ApplicationQuestionView,
  QuestionDefinition,
} from "@openapply/contracts/application-question";
import { prismaFixture } from "@/common/testing/prisma-fakes";
import { ApplicationQuestionService } from "./application-question.service";

export function questionDefinition(key = "authorization"): QuestionDefinition {
  return {
    stableKey: key,
    prompt: `Are you authorized to work in Canada? ${key}`,
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields: [
      {
        key,
        type: "single_choice",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    ],
  };
}

export function questionFixture() {
  const f = prismaFixture();
  const userId = crypto.randomUUID();
  const campaign = { campaignId: crypto.randomUUID(), userId, status: "in_progress" };
  const job = {
    id: crypto.randomUUID(),
    campaignId: campaign.campaignId,
    campaign,
    key: "one",
    title: "Engineer",
    company: "Fixture",
    url: "https://jobs.lever.co/fixture/00000000-0000-4000-8000-000000000001",
    status: "needs_user",
    updatedAt: new Date(),
    submissionAttempt: null,
  };
  f.jobs.push(job);
  f.campaigns.push(campaign);
  const service = new ApplicationQuestionService(f.db);
  const observe = (version = 0, definitions = [questionDefinition()]) => ({
    requestId: crypto.randomUUID(),
    expectedCollectionVersion: version,
    source: "browser_dom" as const,
    sourceUrl: job.url,
    coverage: "complete" as const,
    collectorVersion: "fixture-v1",
    definitions,
  });
  const answer = (question: ApplicationQuestionView, value = "yes") => ({
    requestId: crypto.randomUUID(),
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    confirmed: true as const,
    values: [{ fieldKey: question.definition.fields[0].key, value }],
  });
  return { ...f, userId, campaign, job, questionsService: service, observe, answer };
}
