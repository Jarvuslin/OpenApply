import { chromium } from "playwright-core";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { badRequest, notFound } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { CampaignService } from "@/modules/campaign/campaign.service";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { JobListingPublisher } from "@/modules/job-listing/job-listing.publisher";
import { PilotJournalService } from "@/modules/pilot/journal.service";
import { normalizeFeed } from "./feeds";
import type { sourceInput } from "./mvp.schema";

@singleton()
export class MvpService {
  private readonly starting = new Set<string>();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly publisher: JobListingPublisher,
    private readonly campaigns: CampaignService,
    private readonly jobs: CampaignJobService,
    private readonly journal: PilotJournalService,
  ) {}

  async refresh(userId: string, input: z.infer<typeof sourceInput>) {
    const boardPath = encodeURIComponent(input.board);
    const url =
      input.provider === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${boardPath}`
        : `https://boards-api.greenhouse.io/v1/boards/${boardPath}/jobs?content=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok)
      throw badRequest(
        `Source returned HTTP ${response.status}. Check the board name or try later.`,
      );
    const data = normalizeFeed(input.provider, input.board, await response.json());
    let imported = 0;
    for (const job of data.slice(0, 500))
      if ((await this.publisher.publish({ ...job, publicFeed: true })) !== "skipped") imported++;
    await this.journal.appendJournal(userId, {
      entries: [
        {
          kind: "observation",
          summary: `Imported ${imported} listings from ${input.provider}/${input.board}`,
          detail: {
            source: url,
            mode: "public_listing_api",
            fetched: data.length,
            captchaEncountered: false,
          },
        },
      ],
    });
    return {
      imported,
      fetched: data.length,
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
      captchaSolver: "disabled" as const,
    };
  }

  async start(userId: string, slug: string) {
    if (this.starting.has(userId))
      throw badRequest("An application is already being queued. Wait for that request to finish.");
    this.starting.add(userId);
    try {
      return await this.createSelectedCampaign(userId, slug);
    } finally {
      this.starting.delete(userId);
    }
  }

  private async createSelectedCampaign(userId: string, slug: string) {
    const unanswered = await this.prisma.pilotQuestion.findFirst({
      where: { userId, subjectType: "onboarding", status: "open" },
      select: { id: true },
    });
    if (unanswered)
      throw badRequest(
        "Answer the pending onboarding question in Pilot before applying. Saved defaults are not confirmed eligibility answers.",
      );
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.firstName || !user.lastName || !user.contactEmail || !user.primaryResumeId)
      throw badRequest("Complete your profile and add a resume before applying.");
    const listing = await this.prisma.jobListing.findUnique({
      where: { slug },
      include: { sources: true },
    });
    if (listing?.status !== "published" || !listing.sources[0]) throw notFound("Job not found");
    const url = listing.sources[0].url;
    const active = await this.prisma.job.findFirst({
      where: {
        url,
        campaign: { userId },
        status: { in: ["approved", "applying", "needs_user", "applied"] },
      },
      include: { campaign: true },
    });
    if (active)
      throw badRequest(
        "This job already has an active or completed application. Open its existing campaign.",
      );
    const campaign = await this.campaigns.create(userId, {
      query: `${listing.title} at ${listing.company}`,
      source: "apply",
      createdBy: "user",
      config: { maxApplications: 1, resumeId: user.primaryResumeId },
    });
    await this.jobs.addJob(userId, campaign.campaignId, {
      key: "selected",
      title: listing.title,
      company: listing.company,
      url,
      location: listing.location,
      board: listing.sources[0].board,
      status: "approved",
      description: listing.descriptionExcerpt,
    });
    await this.journal.appendJournal(userId, {
      entries: [
        {
          kind: "action",
          summary: `User approved one application: ${listing.title} at ${listing.company}`,
          subjectType: "campaign",
          subjectId: campaign.campaignId,
          detail: { url, captchaPolicy: "detect_and_pause", browser: "VM CDP :9222" },
        },
      ],
    });
    return { campaignId: campaign.campaignId, title: listing.title, company: listing.company };
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
