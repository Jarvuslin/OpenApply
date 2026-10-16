import { fetchSourceJson, fetchSourceText } from "./http";
import { expect, it, spyOn } from "bun:test";

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
  const mock = spyOn(globalThis, "fetch");
  try {
    mock.mockImplementation(
      Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          return new Response("[]");
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    expect(
      await fetchSourceJson(
        "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
      ),
    ).toEqual([]);
    for (const url of [
      "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
      "https://yc-oss.github.io/api/companies/hiring.json",
    ])
      expect(await fetchSourceJson(url)).toEqual([]);
  } finally {
    mock.mockRestore();
  }
});

it("allows only official Google Careers search and numeric job details with HTML and no redirects", async () => {
  const mock = spyOn(globalThis, "fetch");
  try {
    mock.mockImplementation(
      Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          expect(new Headers(init?.headers).get("Accept")).toBe("text/html");
          return new Response("<html>careers</html>");
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    for (const path of ["", "123-software-engineer"]) {
      expect(
        await fetchSourceText(
          `https://www.google.com/about/careers/applications/jobs/results/${path}`,
        ),
      ).toBe("<html>careers</html>");
    }
  } finally {
    mock.mockRestore();
  }
});

it("keeps feed requests on the allowed host and cancels oversized bodies during streaming", async () => {
  const mock = spyOn(globalThis, "fetch");
  let cancelled = false;
  try {
    mock.mockImplementationOnce(
      Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          expect(init?.signal).toBeDefined();
          expect(new Headers(init?.headers).get("Accept")).toBe(
            "application/json, text/event-stream",
          );
          return new Response('{"ok":true}');
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    expect(
      await fetchSourceJson("https://hiringcafe.com/api/chatgpt/mcp", {
        headers: { Accept: "application/json, text/event-stream" },
      }),
    ).toEqual({ ok: true });
    mock.mockImplementationOnce(
      Object.assign(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(20_000_001));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    await expect(fetchSourceText("https://weworkremotely.com/remote-jobs.rss")).rejects.toThrow(
      "too large",
    );
    expect(cancelled).toBe(true);
  } finally {
    mock.mockRestore();
  }
});

it("allows only the Workday job-search endpoint on Workday hosts", async () => {
  const mock = spyOn(globalThis, "fetch");
  try {
    mock.mockImplementation(
      Object.assign(async () => new Response("{}"), { preconnect: globalThis.fetch.preconnect }),
    );
    expect(
      await fetchSourceJson("https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcglobal1/jobs", {
        method: "POST",
      }),
    ).toEqual({});
    for (const url of [
      "https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/Toronto/Engineer_R1",
      "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/rbcglobal1/jobs?x=1",
      "https://myworkdayjobs.com.evil.example/wday/cxs/rbc/rbcglobal1/jobs",
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});

it("allows only the search page on listed SuccessFactors career sites", async () => {
  const mock = spyOn(globalThis, "fetch");
  try {
    mock.mockImplementation(
      Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) => {
          expect(new Headers(init?.headers).get("Accept")).toBe("text/html");
          return new Response("<html></html>");
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    expect(await fetchSourceText("https://jobs.rogers.com/search/?q=&startrow=0")).toBe(
      "<html></html>",
    );
    for (const url of [
      "https://jobs.rogers.com/services/recruiting/v1/jobs",
      "https://jobs.example.com/search/?q=",
    ])
      await expect(fetchSourceText(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});

it("allows only the search widget on listed Phenom career sites", async () => {
  const mock = spyOn(globalThis, "fetch");
  try {
    mock.mockImplementation(
      Object.assign(async () => new Response("{}"), { preconnect: globalThis.fetch.preconnect }),
    );
    expect(await fetchSourceJson("https://jobs.bell.ca/widgets", { method: "POST" })).toEqual({});
    for (const url of [
      "https://jobs.bell.ca/px-widgets",
      "https://jobs.bell.ca/ca/en/apply?jobSeqNo=1",
      "https://careers.example.com/widgets",
    ])
      await expect(fetchSourceJson(url)).rejects.toThrow("Unsupported discovery endpoint.");
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});
