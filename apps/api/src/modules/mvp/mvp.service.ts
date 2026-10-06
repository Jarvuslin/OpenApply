import { chromium } from "playwright-core";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { badRequest } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { canUseCaptchaSolver } from "@/modules/captcha/entitlement";
import { JobSourcesService } from "@/modules/job-sources/job-sources.service";
import { PilotJournalService } from "@/modules/pilot/journal.service";
import { ApplyQueueService } from "./apply-queue.service";
import type { sourceInput } from "./mvp.schema";

@singleton()
export class MvpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ApplyQueueService,
    private readonly journal: PilotJournalService,
    private readonly sources: JobSourcesService,
  ) {}

  async refresh(userId: string, input: z.infer<typeof sourceInput>) {
    const result = await this.sources.publicBoard(input.provider, input.board);
    const url = `${input.provider}/${input.board}`;
    const { imported, fetched } = result;
    await this.journal.appendJournal(userId, {
      entries: [
        {
          kind: "observation",
          summary: `Imported ${imported} listings from ${input.provider}/${input.board}`,
          detail: {
            source: url,
            mode: "public_listing_api",
            fetched: fetched,
            captchaEncountered: false,
          },
        },
      ],
    });
    return {
      imported,
      fetched: fetched,
      source: url,
      checkedAt: new Date(),
      challenge:
        "No challenge on this API request. Employer signup has not been tested by this request.",
    };
  }

  async readiness(userId: string) {
    const [user, mailbox, unanswered] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.emailAccount.findUnique({ where: { userId } }),
      this.prisma.pilotQuestion.count({
        where: { userId, subjectType: "onboarding", status: "open" },
      }),
    ]);
    let browserVersion = "Not connected";
    try {
      const response = await fetch("http://127.0.0.1:9222/json/version", {
        signal: AbortSignal.timeout(2500),
      });
      const value = (await response.json()) as { Browser: string };
      browserVersion = value.Browser;
    } catch {
      /* Offline is a readiness result. */
    }
    return {
      browser: browserVersion !== "Not connected",
      browserVersion,
      runtime: "Chromium endpoint :9222 — use the VM launcher to start it",
      gmail: !!mailbox && !mailbox.refreshFailedAt,
      profile: !!user.firstName && !!user.lastName && !!user.contactEmail && unanswered === 0,
      resume: !!user.primaryResumeId,
      captchaSolver: canUseCaptchaSolver(user) ? ("enabled" as const) : ("disabled" as const),
    };
  }

  async start(userId: string, slugs: string[]) {
    return this.queue.enqueue(userId, slugs);
  }

  async observe(userId: string) {
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 5000 });
    try {
      const pages = browser.contexts()[0]?.pages() ?? [];
      if (!pages.length) throw badRequest("No browser tab is open.");
      const results = [];
      for (const page of pages) {
        if (!/^https?:/.test(page.url())) continue;
        const title = await page.title();
        const body = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 10000);
        const widgetPresent =
          (await page
            .locator(
              'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .cf-turnstile, .g-recaptcha, .h-captcha',
            )
            .count()) > 0;
        const challengePage =
          /just a moment|verify you are human|checking your browser|unusual traffic|complete the security check/i.test(
            `${title}\n${body}`,
          );
        const url = new URL(page.url());
        url.search = "";
        url.hash = "";
        const result = {
          url: url.toString(),
          title,
          widgetPresent,
          challengePage,
          checkedAt: new Date(),
        };
        await this.journal.appendJournal(userId, {
          entries: [
            {
              kind: "observation",
              summary: challengePage
                ? "Browser challenge detected; human review required"
                : "Browser observation captured",
              detail: {
                url: result.url,
                title,
                widgetPresent,
                challengePage,
                mode: "live_browser_observation",
              },
            },
          ],
        });
        results.push(result);
      }
      return results;
    } finally {
      await browser.close();
    }
  }
}
