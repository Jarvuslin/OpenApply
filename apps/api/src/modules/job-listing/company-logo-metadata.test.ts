import { CompanyLogoService } from "./company-logo.service";
import { companyLogoPage, isGenericBoardLogo, logoFromHtml } from "./company-logo-metadata";
import { describe, expect, it } from "bun:test";

describe("company logo identity", () => {
  it("shares one lookup per ATS tenant and never guesses a company domain", () => {
    expect(companyLogoPage("https://jobs.ashbyhq.com/zip/job-id/application")).toBe(
      "https://jobs.ashbyhq.com/zip",
    );
    expect(companyLogoPage("https://jobs.smartrecruiters.com/Acme/123")).toBe(
      "https://careers.smartrecruiters.com/Acme",
    );
    expect(companyLogoPage("https://stripe.com/jobs/search?gh_jid=123")).toBe("https://stripe.com");
    expect(companyLogoPage("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(companyLogoPage("https://apply.workable.com/j/ABC123/")).toBeNull();
    expect(companyLogoPage("https://apply.workable.com/huggingface/j/ABC123/")).toBe(
      "https://apply.workable.com/huggingface",
    );
    for (const url of [
      "https://news.ycombinator.com/item?id=123",
      "https://remoteok.com/remote-jobs/123",
      "https://weworkremotely.com/remote-jobs/acme",
      "https://hiringcafe.com/jobs",
    ])
      expect(companyLogoPage(url)).toBeNull();
    expect(companyLogoPage("https://jobs.ashbyhq.com")).toBeNull();
    expect(
      companyLogoPage("https://jobs.ashbyhq.com/superhuman%20platform%20inc/job/application"),
    ).toBe("https://jobs.ashbyhq.com/superhuman%20platform%20inc");
  });
  it("prefers Ashby's square company logo over wordmark and platform favicon", () => {
    const html =
      '<link rel="icon" href="/favicon.png"><script>window.settings={"logoWordmarkImageUrl":"https://cdn.example.com/wide.png","logoSquareImageUrl":"https://cdn.example.com/square.png"}</script>';
    expect(logoFromHtml(html, "https://jobs.ashbyhq.com/acme")).toBe(
      "https://cdn.example.com/square.png",
    );
    expect(
      logoFromHtml(
        '<link rel="icon" href="/favicon.png"><meta property="og:image" content="/generic-preview.jpg">',
        "https://jobs.ashbyhq.com/acme",
      ),
    ).toBeNull();
  });
  it("reads structured employer logos, relative branded images, and employer site icons", () => {
    expect(
      logoFromHtml(
        '<script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"logo":{"url":"/logo.svg"}}}</script>',
        "https://example.com/jobs",
      ),
    ).toBe("https://example.com/logo.svg");
    expect(
      logoFromHtml(
        '<img class="company-logo" src="https://cdn.example.com/acme.png">',
        "https://boards.greenhouse.io/acme",
      ),
    ).toBe("https://cdn.example.com/acme.png");
    expect(
      logoFromHtml(
        '<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/icon.png?size=180&amp;v=2">',
        "https://example.com",
      ),
    ).toBe("https://example.com/icon.png?size=180&v=2");
  });
  it("ignores unsafe metadata and unrelated social images", () => {
    expect(
      logoFromHtml(
        '<img class="company-logo" src="http://localhost/logo.png"><meta property="og:image" content="https://example.com/team.jpg">',
        "https://example.com",
      ),
    ).toBeNull();
  });
  it("does not mistake customer logos on the employer homepage for its own branding", () => {
    expect(
      logoFromHtml(
        '<link rel="apple-touch-icon" href="/acme.png"><section><img class="company-logo" src="https://customer.com/logo.svg"></section>',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/acme.png");
    expect(
      logoFromHtml(
        '<header><img alt="Acme logo" src="/brand.svg"></header><img class="company-logo" src="https://customer.com/logo.svg">',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/brand.svg");
  });
  it("reads the branded header image on Greenhouse boards", () => {
    expect(
      logoFromHtml(
        '<a class="logo"><img alt="Anthropic Logo" src="https://cdn.example.com/anthropic.png"></a>',
        "https://job-boards.greenhouse.io/anthropic",
      ),
    ).toBe("https://cdn.example.com/anthropic.png");
    expect(
      logoFromHtml(
        '<img alt="Reddit Logo" class="logo" src="https://cdn.example.com/reddit.png">',
        "https://job-boards.greenhouse.io/reddit",
      ),
    ).toBe("https://cdn.example.com/reddit.png");
    expect(
      logoFromHtml(
        '<meta property="og:image" content="https://cdn.example.com/org-theme-logo/huggingface.png">',
        "https://apply.workable.com/huggingface",
      ),
    ).toBe("https://cdn.example.com/org-theme-logo/huggingface.png");
  });
  it("rejects known job-board branding without discarding hosted employer logos", () => {
    for (const url of [
      "https://news.ycombinator.com/y18.svg",
      "https://remoteok.com/assets/logo.png",
      "https://weworkremotely.com/assets/wwr-social-hash.png",
    ])
      expect(isGenericBoardLogo(url)).toBe(true);
    expect(isGenericBoardLogo("https://remoteok.com/assets/img/jobs/acme.png")).toBe(false);
    expect(
      logoFromHtml(
        '<link rel="icon" href="https://cdn.example.com/board.png">',
        "https://remoteok.com",
      ),
    ).toBeNull();
    expect(
      logoFromHtml(
        '<meta property="og:image" content="https://workablehr.s3.amazonaws.com/uploads/account/open_graph_logo/514327/social?1779458237000">',
        "https://apply.workable.com/huggingface",
      ),
    ).toBe(
      "https://workablehr.s3.amazonaws.com/uploads/account/open_graph_logo/514327/social?1779458237000",
    );
  });
});

describe("company logo cache", () => {
  class Logos extends CompanyLogoService {
    reads: string[] = [];
    checks: string[] = [];
    protected override async readImage(url: string) {
      this.checks.push(url);
      return url;
    }
    protected override async readPage(url: string) {
      this.reads.push(url);
      return { url, html: '<img class="company-logo" src="https://cdn.example.com/acme.png">' };
    }
  }
  it("coalesces concurrent jobs from the same board and retains explicit source logos", async () => {
    const logos = new Logos();
    const results = await Promise.all(
      ["one", "two"].map((job) =>
        logos.resolve({ urls: [`https://jobs.ashbyhq.com/acme/${job}`] }),
      ),
    );
    expect(results).toEqual([
      "https://cdn.example.com/acme.png",
      "https://cdn.example.com/acme.png",
    ]);
    expect(logos.reads).toHaveLength(1);
    expect(logos.checks).toEqual(["https://cdn.example.com/acme.png"]);
    expect(
      await logos.resolve({
        companyLogoUrl: "https://cdn.example.com/explicit.png",
        urls: ["https://example.com"],
      }),
    ).toBe("https://cdn.example.com/explicit.png");
    expect(logos.reads).toHaveLength(1);
  });
  it("continues after broken metadata and coalesces image validation across employers", async () => {
    class Alternatives extends CompanyLogoService {
      checks: string[] = [];
      protected override async readPage(url: string) {
        return {
          url,
          html: '<script type="application/ld+json">{"@type":"Organization","logo":"https://cdn.example.com/broken.png"}</script><link rel="icon" href="https://cdn.example.com/working.png">',
        };
      }
      protected override async readImage(url: string) {
        this.checks.push(url);
        return url.includes("broken") ? null : url;
      }
    }
    const logos = new Alternatives();
    expect(
      await Promise.all(
        ["https://acme.com", "https://other.com"].map((url) =>
          logos.resolve({ companyLogoUrl: "https://cdn.example.com/broken.png", urls: [url] }),
        ),
      ),
    ).toEqual(["https://cdn.example.com/working.png", "https://cdn.example.com/working.png"]);
    expect(logos.checks).toEqual([
      "https://cdn.example.com/broken.png",
      "https://cdn.example.com/working.png",
    ]);
  });
  it("rejects a logo redirect that ends at generic job-board branding", async () => {
    class Redirected extends CompanyLogoService {
      protected override async readImage() {
        return "https://remoteok.com/assets/logo.png";
      }
    }
    expect(
      await new Redirected().resolve({ companyLogoUrl: "https://company.com/logo.png", urls: [] }),
    ).toBeNull();
  });
  it("caches missing logos too and tries other documented sources", async () => {
    class Missing extends CompanyLogoService {
      reads = 0;
      protected override async readPage() {
        this.reads++;
        return null;
      }
    }
    const logos = new Missing();
    expect(
      await logos.resolve({ urls: ["https://jobs.ashbyhq.com/acme/a", "https://example.com"] }),
    ).toBeNull();
    expect(
      await logos.resolve({ urls: ["https://jobs.ashbyhq.com/acme/b", "https://example.com"] }),
    ).toBeNull();
    expect(logos.reads).toBe(2);
  });
});
