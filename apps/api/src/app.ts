import { Elysia } from "elysia";
import { z } from "zod/v4";
import { db } from "@/common/database/prisma.client";
import { container } from "@/common/di/container";
import { logger } from "@/common/logger";
import { errorMiddleware } from "@/common/middleware";
import { corsPlugin } from "@/common/plugins/cors.plugin";
import { openapiPlugin } from "@/common/plugins/openapi.plugin";
import { env } from "@/env";
import { accountSetupController } from "@/modules/account-setup/account-setup.controller";
import { adminController } from "@/modules/admin/admin.controller";
import { analyticsController } from "@/modules/analytics/analytics.controller";
import { answerBankController } from "@/modules/answer-bank/answer-bank.controller";
import { applicationController } from "@/modules/application/application.controller";
import { applicationPreparationController } from "@/modules/application-question/application-preparation.controller";
import { applicationQuestionController } from "@/modules/application-question/application-question.controller";
import { authController } from "@/modules/auth/auth.controller";
import { authProvidersController } from "@/modules/auth/providers.controller";
import { securityController } from "@/modules/auth/security.controller";
import { campaignController } from "@/modules/campaign/campaign.controller";
import { campaignJobController } from "@/modules/campaign/jobs/job.controller";
import { captchaController } from "@/modules/captcha/captcha.controller";
import { coverLetterController } from "@/modules/cover-letter/cover-letter.controller";
import { credentialController } from "@/modules/credential/credential.controller";
import { emailAccountController } from "@/modules/email/account/account.controller";
import { emailMessagesController } from "@/modules/email/messages.controller";
import { intakePreparationController } from "@/modules/intake-preparation/intake-preparation.controller";
import { adminBoardController } from "@/modules/job-board/admin-board.controller";
import { jobBoardController } from "@/modules/job-board/job-board.controller";
import { jobIntakeController } from "@/modules/job-intakes/job-intake.controller";
import { adminJobListingController, publicJobListingController } from "@/modules/job-listing";
import { jobListingController } from "@/modules/job-listing/job-listing.controller";
import { catalogRefreshJob } from "@/modules/job-sources/catalog-refresh.job";
import { discoveryFeedController } from "@/modules/job-sources/discovery-feed.controller";
import { jobSourcesController } from "@/modules/job-sources/job-sources.controller";
import { linkedinDiscoveryController } from "@/modules/job-sources/linkedin-discovery.controller";
import { locationsController } from "@/modules/locations/locations.controller";
import { cleanupJob } from "@/modules/maintenance/cleanup.job";
import { screenshotsJob } from "@/modules/maintenance/screenshots.job";
import { mvpController } from "@/modules/mvp/mvp.controller";
import { pilotAgendaController } from "@/modules/pilot/agenda/agenda.controller";
import { pilotJournalController } from "@/modules/pilot/journal.controller";
import { pilotController } from "@/modules/pilot/pilot.controller";
import { pilotQuestionsController } from "@/modules/pilot/question.controller";
import { pilotSearchController } from "@/modules/pilot/search.controller";
import { pilotsController } from "@/modules/pilots/pilots.controller";
import { pilotsJob } from "@/modules/pilots/pilots.job";
import { pushController } from "@/modules/push/push.controller";
import { resumeEvidenceController } from "@/modules/resume/evidence/resume-evidence.controller";
import { resumeController } from "@/modules/resume/resume.controller";
import { resumeVariantController } from "@/modules/resume/variants/variant.controller";
import { runtimePresenceController } from "@/modules/runtime-presence/runtime-presence.controller";
import { scoringController } from "@/modules/scoring/scoring.controller";
import { scoringEvaluationController } from "@/modules/scoring-evaluation/scoring-evaluation.controller";
import { telegramController } from "@/modules/telegram/telegram.controller";
import { TelegramPolling } from "@/modules/telegram/telegram.polling";
import { TelegramScheduler } from "@/modules/telegram/telegram.scheduler";
import { telegramWebhookController } from "@/modules/telegram/telegram.webhook";
import { userController } from "@/modules/user/user.controller";
import { workQueueController } from "@/modules/work-queue/work-queue.controller";
import { workspaceController } from "@/modules/workspace/workspace.controller";
import { httpErrorResponses } from "@/types/response";
import { version } from "../../../package.json";

const telegramScheduler = container.resolve(TelegramScheduler);
const telegramPolling = container.resolve(TelegramPolling);

// Regression harnesses poll `/health`; the plugin, Docker and docs use `/api/health`.
const health = () => ({ version, time: new Date() });
const healthRoute = {
  response: z.object({ version: z.string(), time: z.date() }),
  detail: {
    tags: ["Health"],
    summary: "Check API liveness",
    description: "Returns the release version and the current server time.",
  },
};

const app = new Elysia()
  .onStart(() => {
    telegramScheduler.start();
    telegramPolling.start();
  })
  .use(errorMiddleware)
  .use(corsPlugin)
  .use(openapiPlugin)
  .use(screenshotsJob)
  .use(cleanupJob)
  .use(catalogRefreshJob)
  .use(pilotsJob)
  .onStop(async () => {
    telegramScheduler.stop();
    await db.$disconnect();
  })
  .get("/health", health, healthRoute)

  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) =>
    api
      .use(authController)
      .use(mvpController)
      .use(securityController)
      .use(authProvidersController)
      .get("/health", health, healthRoute)
      .use(jobBoardController)
      .use(credentialController)
      .use(analyticsController)
      .use(captchaController)
      .use(workQueueController)
      .use(jobIntakeController)
      .use(intakePreparationController)
      .use(accountSetupController)
      .use(runtimePresenceController)
      .use(telegramController)
      .use(telegramWebhookController)
      .use(applicationQuestionController)
      .use(applicationPreparationController)
      .use(answerBankController)
      .use(userController)
      .use(locationsController)
      .use(resumeController)
      .use(resumeEvidenceController)
      .use(resumeVariantController)
      .use(publicJobListingController)
      .use(jobListingController)
      .use(jobSourcesController)
      .use(linkedinDiscoveryController)
      .use(discoveryFeedController)
      .use(coverLetterController)
      .use(applicationController)
      .use(scoringController)
      .use(scoringEvaluationController)
      .use(campaignController)
      .use(campaignJobController)
      .use(pilotController)
      .use(pilotSearchController)
      .use(pilotsController)
      .use(pilotAgendaController)
      .use(pilotJournalController)
      .use(pilotQuestionsController)
      .use(pushController)
      .use(workspaceController)
      .use(emailAccountController)
      .use(emailMessagesController)
      // Mounted one by one: an array widens them to AnyElysia and collapses the `App` type Eden reads.
      .use(adminController)
      .use(adminBoardController)
      .use(adminJobListingController),
  )
  .listen({
    port: env.PORT,
    hostname: env.MVP_LOCAL_RUNNER ? "127.0.0.1" : "0.0.0.0",
    idleTimeout: env.MVP_LOCAL_RUNNER ? 150 : 30,
  });

logger.info(`OpenApply API running at http://localhost:${app.server?.port}`);
if (env.NODE_ENV === "development") {
  logger.info(`Swagger docs at http://localhost:${app.server?.port}/swagger`);
}

// Eden Treaty contract for the frontend.
export type App = typeof app;
