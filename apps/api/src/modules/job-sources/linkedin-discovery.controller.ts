import {
  linkedinIngestResultSchema,
  linkedinIngestSchema,
  linkedinRunInputSchema,
  linkedinRunSchema,
  linkedinSettingsInputSchema,
  linkedinSettingsSchema,
} from "@openapply/contracts/linkedin-discovery";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { LinkedinDiscoveryService } from "./linkedin-discovery.service";

const service = container.resolve(LinkedinDiscoveryService);
export const linkedinDiscoveryController = new Elysia({
  prefix: "/job-sources/linkedin",
  detail: { tags: ["Discovery"] },
})
  .use(authGuard)
  .get("/settings", ({ user }) => service.settings(user.id), {
    response: linkedinSettingsSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverRead),
    detail: { summary: "Read this user's opt-in LinkedIn discovery settings" },
  })
  .put("/settings", ({ user, body }) => service.configure(user.id, body), {
    body: linkedinSettingsInputSchema,
    response: linkedinSettingsSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverSave),
    detail: { summary: "Configure up to four private LinkedIn discovery searches" },
  })
  .post("/runs", ({ user }) => service.claim(user.id), {
    body: linkedinRunInputSchema,
    response: linkedinRunSchema,
    beforeHandle: rateLimit(RATE_LIMITS.discoverSearch),
    detail: { summary: "Claim this user's daily bounded LinkedIn discovery run" },
  })
  .post("/ingest", ({ user, body }) => service.ingest(user.id, body), {
    body: linkedinIngestSchema,
    response: linkedinIngestResultSchema,
    beforeHandle: rateLimit(RATE_LIMITS.mailboxIngest),
    detail: { summary: "Complete an owned discovery run and resolve employer postings" },
  });
