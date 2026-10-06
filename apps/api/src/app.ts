import "@/common/di/container";
import { Elysia } from "elysia";
import { db } from "@/common/database/prisma.client";
import { logger } from "@/common/logger";
import { errorMiddleware } from "@/common/middleware";
import { corsPlugin } from "@/common/plugins/cors.plugin";
import { openapiPlugin } from "@/common/plugins/openapi.plugin";
import { env } from "@/env";
import { adminController } from "@/modules/admin/admin.controller";
import { analyticsController } from "@/modules/analytics/analytics.controller";
import { applicationController } from "@/modules/application/application.controller";
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
import { emailOAuthController } from "@/modules/email/oauth.controller";
import { healthController } from "@/modules/health/health.controller";
import { adminBoardController } from "@/modules/job-board/admin-board.controller";
import { jobBoardController } from "@/modules/job-board/job-board.controller";
import { adminJobListingController, publicJobListingController } from "@/modules/job-listing";
import { cleanupJob } from "@/modules/maintenance/cleanup.job";
import { pdfCacheJob } from "@/modules/maintenance/pdf-cache.job";
import { mvpController } from "@/modules/mvp/mvp.controller";
import { pilotAgendaController } from "@/modules/pilot/agenda/agenda.controller";
import { pilotJournalController } from "@/modules/pilot/journal.controller";
import { pilotController } from "@/modules/pilot/pilot.controller";
import { pilotQuestionsController } from "@/modules/pilot/question.controller";
import { pilotSearchController } from "@/modules/pilot/search.controller";
import { pushController } from "@/modules/push/push.controller";
import { resumeController } from "@/modules/resume/resume.controller";
import { resumeVariantController } from "@/modules/resume/variants/variant.controller";
import { scoringController } from "@/modules/scoring/scoring.controller";
import { userController } from "@/modules/user/user.controller";
import { workspaceController } from "@/modules/workspace/workspace.controller";
import { httpErrorResponses } from "@/types/response";

const app = new Elysia()
  .use(errorMiddleware)
  .use(corsPlugin)
  .use(openapiPlugin)
  .use(pdfCacheJob)
  .use(cleanupJob)
  .onStop(async () => {
    await db.$disconnect();
  })
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) =>
    api
      .use(authController)
      .use(mvpController)
      .use(securityController)
      .use(authProvidersController)
      .use(healthController)
      .use(jobBoardController)
      .use(credentialController)
      .use(analyticsController)
      .use(captchaController)
      .use(userController)
      .use(resumeController)
      .use(resumeVariantController)
      .use(publicJobListingController)
      .use(coverLetterController)
      .use(applicationController)
      .use(scoringController)
      .use(campaignController)
      .use(campaignJobController)
      .use(pilotController)
      .use(pilotSearchController)
      .use(pilotAgendaController)
      .use(pilotJournalController)
      .use(pilotQuestionsController)
      .use(pushController)
      .use(workspaceController)
      .use(emailAccountController)
      .use(emailMessagesController)
      .use(emailOAuthController)
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

logger.info(`JobPilot API running at http://localhost:${app.server?.port}`);
if (env.NODE_ENV === "development") {
  logger.info(`Swagger docs at http://localhost:${app.server?.port}/swagger`);
}

// Eden Treaty contract for the frontend.
export type App = typeof app;
