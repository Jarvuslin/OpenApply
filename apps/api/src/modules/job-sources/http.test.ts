import { fetchSourceJson, fetchSourceText, SourceResponseError } from "./http";
import { expect, it, spyOn } from "bun:test";

/** Serve each request with `handler`; robots.txt comes from `robots` by host, else a 404. */
function serve(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  robots: Record<string, string> = {},
) {
  const calls: string[] = [];
  const robotsRequests: string[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/robots.txt")) {
          const host = new URL(url).hostname;
          robotsRequests.push(host);
          const body = robots[host];
          return body === undefined ? new Response("", { status: 404 }) : new Response(body);
        }
        calls.push(url);
        return handler(url, init);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  return { calls, robotsRequests, restore: () => mock.mockRestore() };
}

it("rejects unsupported hosts, credentials, ports and protocols before fetching", async () => {
  for (const url of [
    "https://example.com/feed",
    "http://remoteok.com/api",
    "https://secret@remoteok.com/api",
    "https://remoteok.com:8443/api",
    "https://remoteok.com.evil.test/api",
    "https://www.google.com/search?q=jobs",
    "https://www.google.com/url?q=https://example.com",
    "https://www.google.com/about/careers/applications/apply?jobId=x",
    "https://google.com/about/careers/applications/jobs/results/",
    "https://www.google.com:8443/about/careers/applications/jobs/results/",
    "https://www.google.com/about/careers/applications/jobs/results/not-a-job",
    "https://raw.githubusercontent.com/another/repo/main/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/main/README.md",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md?redirect=1",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/util.py",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
    "https://yc-oss.github.io/api/companies/all.json",
    "https://yc-oss.github.io/api/companies/hiring.json?x=1",
  ])
    await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint");
});

it("allows only the fixed Simplify lists and YC hiring directory with no redirects", async () => {
  const server = serve((_url, init) => {
    expect(init?.redirect).toBe("error");
    return new Response("[]");
  });
  try {
    for (const url of [
      "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
      "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
      "https://yc-oss.github.io/api/companies/hiring.json",
    ])
      expect(await fetchSourceJson(url)).toEqual([]);
  } finally {
    server.restore();
  }
});

it("allows only official Google Careers search and numeric job details with HTML and no redirects", async () => {
  const server = serve((_url, init) => {
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/html");
    return new Response("<html>careers</html>");
  });
  try {
    for (const path of ["", "123-software-engineer"]) {
      expect(
        await fetchSourceText(
          `https://www.google.com/about/careers/applications/jobs/results/${path}`,
        ),
      ).toBe("<html>careers</html>");
    }
  } finally {
    server.restore();
  }
});

it("keeps feed requests on the allowed host and cancels oversized bodies during streaming", async () => {
  let cancelled = false;
  const server = serve((url, init) => {
    if (url.startsWith("https://hiringcafe.com/")) {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeDefined();
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json, text/event-stream");
      return new Response('{"ok":true}');
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(20_000_001));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  });
  try {
    expect(
      await fetchSourceJson("https://hiringcafe.com/api/chatgpt/mcp", {
        headers: { Accept: "application/json, text/event-stream" },
      }),
    ).toEqual({ ok: true });
    const oversized = fetchSourceText("https://weworkremotely.com/remote-jobs.rss");
    await expect(oversized).rejects.toThrow("too large");
    await expect(oversized).rejects.toMatchObject({ tooLarge: true });
    expect(cancelled).toBe(true);
  } finally {
    server.restore();
  }
});

it("allows only the Workday job search and job detail endpoints on Workday hosts", async () => {
  const server = serve(() => new Response("{}"));
  try {
    for (const url of [
      "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcearlytalent1/jobs",
      "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcearlytalent1/job/Toronto/Analyst_R-1",
    ])
      expect(await fetchSourceJson(url, { method: "POST" })).toEqual({});
    for (const url of [
      "https://rbc.wd3.myworkdayjobs.com/rbcearlytalent1/job/Toronto/Engineer_R1",
      "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcearlytalent1/jobs?x=1",
      "https://myworkdayjobs.com.evil.example/wday/cxs/rbc/rbcearlytalent1/jobs",
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(2);
  } finally {
    server.restore();
  }
});

it("allows only the requisition search on Oracle Recruiting hosts", async () => {
  const server = serve(() => new Response("{}"));
  const search =
    "/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1,limit=200,offset=400,sortBy=POSTING_DATES_DESC";
  try {
    expect(await fetchSourceJson(`https://eeho.fa.us2.oraclecloud.com${search}`)).toEqual({});
    expect(
      await fetchSourceJson(
        "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22302443%22,siteNumber=CX_1",
      ),
    ).toEqual({});
    for (const url of [
      "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/workers",
      `https://eeho.fa.us2.oraclecloud.com${search}&q=1`,
      `https://oraclecloud.com.evil.example${search}`,
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(2);
  } finally {
    server.restore();
  }
});

it("allows only a section's search page, job pages and job board API on Taleo hosts", async () => {
  const server = serve(() => new Response("{}"));
  try {
    for (const url of [
      "https://uab.taleo.net/careersection/ext/jobsearch.ftl?lang=en",
      "https://uab.taleo.net/careersection/ext/jobdetail.ftl?job=328178&lang=en",
    ])
      expect(await fetchSourceText(url)).toBe("{}");
    expect(
      await fetchSourceJson(
        "https://uab.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=8100108034",
        { method: "POST" },
      ),
    ).toEqual({});
    for (const url of [
      "https://uab.taleo.net/careersection/ext/jobapply.ftl?job=328178&lang=en",
      "https://uab.taleo.net/careersection/ext/jobsearch.ajax",
      "https://uab.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=x",
      "https://taleo.net.evil.example/careersection/ext/jobsearch.ftl?lang=en",
    ])
      await expect(fetchSourceText(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(3);
  } finally {
    server.restore();
  }
});

it("allows only the offers API on Recruitee boards", async () => {
  const server = serve(() => new Response("{}"));
  try {
    expect(await fetchSourceJson("https://huaweicanada.recruitee.com/api/offers/")).toEqual({});
    for (const url of [
      "https://huaweicanada.recruitee.com/o/researcher",
      "https://huaweicanada.recruitee.com/api/offers/?scope=all",
      "https://recruitee.com.evil.example/api/offers/",
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(1);
  } finally {
    server.restore();
  }
});

it("allows only the search and job pages on iCIMS portals", async () => {
  const server = serve(() => new Response("<html></html>"));
  try {
    for (const url of [
      "https://careers-peraton.icims.com/jobs/search?ss=1&in_iframe=1&pr=3",
      "https://careers-sas.icims.com/jobs/44619/software-developer---back-end-%283-5-years%29/job?in_iframe=1",
    ])
      expect(await fetchSourceText(url)).toBe("<html></html>");
    for (const url of [
      "https://careers-peraton.icims.com/jobs/172471/engineer/login?in_iframe=1",
      "https://careers-peraton.icims.com/jobs/search?ss=1&searchKeyword=x",
      "https://careers-peraton.icims.com/jobs/172471/engineer/job",
      "https://icims.com.evil.example/jobs/search?ss=1&in_iframe=1&pr=0",
    ])
      await expect(fetchSourceText(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(2);
  } finally {
    server.restore();
  }
});

it("refuses a Workday site its tenant's robots.txt disallows, whatever its case", async () => {
  const server = serve(() => new Response("{}"), {
    "acme.wd3.myworkdayjobs.com": "User-agent: *\nDisallow: /ACMEGLOBAL/\nDisallow: /refreshFacet/",
  });
  try {
    await expect(
      fetchSourceJson("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/acmeglobal/jobs"),
    ).rejects.toThrow("robots.txt");
    expect(
      await fetchSourceJson("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/campus/jobs"),
    ).toEqual({});
    expect(server.calls).toEqual(["https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/campus/jobs"]);
  } finally {
    server.restore();
  }
});

it("allows only the search and job pages on listed SuccessFactors career sites", async () => {
  const server = serve((_url, init) => {
    expect(new Headers(init?.headers).get("Accept")).toBe("text/html");
    return new Response("<html></html>");
  });
  try {
    for (const url of [
      "https://jobs.rogers.com/search/?q=&startrow=0",
      "https://jobs.rogers.com/job/Toronto-Developer-ON/1430664500/",
      "https://jobs.scotiabank.com/Tangerine/job/Toronto-Manager-ON/606071317/",
    ])
      expect(await fetchSourceText(url)).toBe("<html></html>");
    for (const url of [
      "https://jobs.rogers.com/services/recruiting/v1/jobs",
      "https://jobs.example.com/search/?q=",
    ])
      await expect(fetchSourceText(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(3);
  } finally {
    server.restore();
  }
});

it("refuses a career site page its robots.txt disallows", async () => {
  const server = serve(() => new Response("<html></html>"), {
    "careers.telus.com": "User-agent: *\nDisallow: /search/",
  });
  try {
    await expect(fetchSourceText("https://careers.telus.com/search/?q=")).rejects.toThrow(
      "robots.txt",
    );
    expect(server.calls).toEqual([]);
  } finally {
    server.restore();
  }
});

it("exempts only SmartRecruiters' posting API from robots.txt, for personal use", async () => {
  const server = serve(() => Response.json({ content: [] }), {
    "api.smartrecruiters.com":
      "User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /",
  });
  try {
    expect(
      await fetchSourceJson("https://api.smartrecruiters.com/v1/companies/ServiceNow/postings"),
    ).toEqual({ content: [] });
    expect(server.robotsRequests).not.toContain("api.smartrecruiters.com");
  } finally {
    server.restore();
  }
});

it("allows only the search widget on listed Phenom career sites", async () => {
  const server = serve(() => new Response("{}"));
  try {
    expect(await fetchSourceJson("https://jobs.bell.ca/widgets", { method: "POST" })).toEqual({});
    for (const url of [
      "https://jobs.bell.ca/px-widgets",
      "https://jobs.bell.ca/ca/en/apply?jobSeqNo=1",
      "https://careers.example.com/widgets",
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(server.calls).toHaveLength(1);
  } finally {
    server.restore();
  }
});

it("backs off the whole host on 429 and reports how long to wait", async () => {
  const server = serve(() => new Response("", { status: 429, headers: { "retry-after": "0" } }));
  try {
    const error = await fetchSourceJson("https://api.apify.com/v2/acts").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceResponseError);
    expect(error).toMatchObject({ upstreamStatus: 429 });
    expect((error as SourceResponseError).retryAfterMs).toBeGreaterThanOrEqual(16_000);
    expect(server.calls).toHaveLength(3);
  } finally {
    server.restore();
  }
}, 15_000);

it("exempts calls made with the user's own API key, since robots.txt governs crawling", async () => {
  const server = serve(() => Response.json({ ok: true }), {
    "serpapi.com": "User-agent: *\nDisallow: /search.json",
  });
  try {
    expect(
      await fetchSourceJson("https://serpapi.com/search.json?engine=google_jobs&api_key=user-key"),
    ).toEqual({ ok: true });
    await expect(
      fetchSourceJson("https://serpapi.com/search.json?engine=google_jobs"),
    ).rejects.toThrow("robots.txt");
    expect(server.robotsRequests).toEqual(["serpapi.com"]);
  } finally {
    server.restore();
  }
});

it("exempts RBC's Workday host, whose robots.txt disallows its main career site", async () => {
  const server = serve(() => Response.json({ total: 0, jobPostings: [] }), {
    "rbc.wd3.myworkdayjobs.com": "User-agent: *\nDisallow: /RBCGLOBAL1/",
  });
  try {
    expect(
      await fetchSourceJson("https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcglobal1/jobs"),
    ).toEqual({ total: 0, jobPostings: [] });
    expect(server.robotsRequests).not.toContain("rbc.wd3.myworkdayjobs.com");
  } finally {
    server.restore();
  }
});

it("keeps at most four Workday requests in flight across every tenant host", async () => {
  let active = 0;
  let peak = 0;
  const server = serve(async () => {
    active++;
    peak = Math.max(peak, active);
    await Bun.sleep(30);
    active--;
    return Response.json({ total: 0, jobPostings: [] });
  });
  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetchSourceJson(`https://tenant${i}.wd5.myworkdayjobs.com/wday/cxs/tenant${i}/site/jobs`),
      ),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(server.calls).toHaveLength(10);
  } finally {
    server.restore();
  }
}, 15_000);
