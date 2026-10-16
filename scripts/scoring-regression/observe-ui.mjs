import {
  assertLoopbackOrigins,
  questionsUiDiagnosticAllowed,
  runGuestObserver,
} from "../questions-regression/observe-ui.mjs";

export function scoringUiRequestAllowed(method, address, body, config) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (
    ![config.webUrl, config.apiUrl].includes(url.origin) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  if (url.origin === config.webUrl) {
    if (!["GET", "HEAD"].includes(method)) return false;
    if (url.pathname.startsWith("/__nextjs_"))
      return url.pathname === "/__nextjs_font/geist-latin.woff2" && !url.search;
    return !url.pathname.startsWith("/api/");
  }
  if (
    method === "OPTIONS" &&
    ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname)
  )
    return !url.search;
  if (method === "POST") {
    if (url.search) return false;
    if (["/api/auth/refresh", "/api/auth/logout"].includes(url.pathname))
      return body === null || body === undefined || body === "null" || body === "";
    if (url.pathname !== "/api/auth/login") return false;
    try {
      const parsed = JSON.parse(body);
      return (
        Object.keys(parsed).sort().join(",") === "email,password" &&
        parsed.email === config.loginEmail &&
        parsed.password === config.password
      );
    } catch {
      return false;
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  if (
    [
      "/api/auth/me",
      "/api/auth/options",
      "/api/analytics",
      "/api/needs-you/count",
      "/api/needs-you/events",
      "/api/workspace/events",
    ].includes(url.pathname)
  )
    return !url.search;
  const prefix = "/api/score-evaluations";
  const runId = [config.pendingRunId, config.syntheticRunId].find((id) =>
    [`${prefix}/${id}`, `${prefix}/${id}/report`, `${prefix}/${id}/cases`].includes(url.pathname),
  );
  if (url.pathname !== prefix && !runId) return false;
  if (url.pathname === prefix || url.pathname.endsWith("/cases"))
    return (
      [...url.searchParams.keys()].every((key) => ["page", "limit"].includes(key)) &&
      [...url.searchParams.values()].every((value) => /^[1-9]\d{0,3}$/.test(value))
    );
  return !url.search;
}

async function observeInGuest(config) {
  const { chromium } = await import(
    "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const observations = [],
    screenshots = [],
    blockedRequests = [],
    diagnostics = [];
  const expectedResources = new Map();
  let stage = "login",
    step = "open-login",
    injectListError = true,
    diagnosticRequests = 0,
    authRequests = 0,
    diagnosticsTruncated = false;
  const failureMessages = {
    "fixture-invalid":
      "The fixture is not an unrun evaluation plus excluded synthetic comparisons.",
    "read-failed": "An owned evaluation read failed.",
    "count-mismatch": "The rendered count differs from the run-wide API report.",
    "unexpected-controls": "The report exposes an execution control.",
    "pagination-invalid": "Pagination did not preserve the selected page and run-wide totals.",
    "report-mutated": "Read-only navigation changed evaluation evidence.",
    "unexpected-request": "The UI attempted a request outside its read-only fixture scope.",
    "browser-error": "The browser reported an unexpected runtime error.",
  };
  function fail(code) {
    throw Object.assign(new Error(failureMessages[code]), { code });
  }
  function resource(address) {
    try {
      const url = new URL(address);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return null;
    }
  }
  function diagnostic(kind, message, address) {
    if (diagnostics.length >= 50) {
      diagnosticsTruncated = true;
      return;
    }
    const safe = String(message)
      .replaceAll(config.password, "[redacted]")
      .replaceAll(config.loginEmail, "[synthetic email]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
      .replace(
        /((?:password|apiToken|accessToken|refreshToken|authorization)["'\s:=]+)[^\s,;}]+/gi,
        "$1[redacted]",
      )
      .slice(0, 2000);
    diagnostics.push({ kind, stage, message: safe, resource: resource(address) });
  }
  function expectResource(address, status) {
    const key = resource(address);
    const statuses = expectedResources.get(key) ?? new Set();
    statuses.add(status);
    expectedResources.set(key, statuses);
  }
  page.on("pageerror", (error) => diagnostic("pageerror", error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      diagnostic(message.type(), message.text(), message.location().url);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      stage === "login" &&
      response.status() === 401 &&
      url.origin === config.apiUrl &&
      url.pathname.startsWith("/api/auth/")
    )
      expectResource(response.url(), "401");
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (questionsUiDiagnosticAllowed(request.method(), request.url(), request.postData(), config)) {
      diagnosticRequests++;
      await route.continue();
      return;
    }
    if (!scoringUiRequestAllowed(request.method(), request.url(), request.postData(), config)) {
      if (
        request.method() === "GET" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["/queue/status"].includes(url.pathname) &&
        ![config.webUrl, config.apiUrl].includes(url.origin)
      )
        expectResource(request.url(), "ERR_BLOCKED_BY_CLIENT");
      blockedRequests.push({
        method: request.method(),
        protocol: url.protocol,
        hostname: url.hostname,
        origin: url.origin,
        pathname: url.pathname,
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "POST") authRequests++;
    if (
      injectListError &&
      request.method() === "GET" &&
      url.origin === config.apiUrl &&
      url.pathname === "/api/score-evaluations"
    ) {
      injectListError = false;
      expectResource(request.url(), "503");
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": config.webUrl,
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ message: "Synthetic read interruption" }),
      });
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    if (url.origin === config.webUrl) socket.connectToServer();
    else socket.close();
  });
  async function read(path) {
    const result = await page.evaluate(async (address) => {
      const response = await fetch(address, { credentials: "include" });
      return { ok: response.ok, body: response.ok ? await response.json() : null };
    }, `${config.apiUrl}${path}`);
    if (!result.ok) fail("read-failed");
    return result.body;
  }
  async function record(name) {
    observations.push({ name, passed: true });
    screenshots.push({
      name,
      screenshot: (
        await page.screenshot({
          fullPage: true,
          mask: [page.locator("input"), page.locator("textarea")],
        })
      ).toString("base64"),
    });
  }
  async function counts(report) {
    const panel = page.locator(`[data-scoring-report-id="${report.run.id}"]`);
    for (const [key, label] of Object.entries({
      totalCases: "Total cases",
      validPairs: "Valid pairs",
      measuredPairs: "Measured pairs",
      excludedPairs: "Excluded pairs",
      failedCases: "Failed cases",
      unrunCases: "Unrun cases",
      incompleteCases: "Incomplete cases",
    })) {
      const rendered = panel.locator(`[data-scoring-count="${key}"]`);
      await rendered.waitFor();
      if ((await rendered.textContent()) !== `${label}: ${report[key]}`) fail("count-mismatch");
    }
    return panel;
  }
  try {
    await page.goto(`${config.webUrl}/login?next=/analytics`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/analytics`, { timeout: 60_000 });
    stage = "evaluation-list";
    step = "analytics-entry";
    await page.getByRole("heading", { name: "Analytics", exact: true }).waitFor();
    await page.getByRole("link", { name: "Scoring evaluations", exact: true }).click();
    await page.getByRole("heading", { name: "Scoring evaluations", exact: true }).waitFor();
    step = "recover-list-read-error";
    await page.getByText("Could not load scoring evaluations.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry evaluations", exact: true }).click();
    await page.locator(`[data-scoring-run-id="${config.pendingRunId}"]`).waitFor();
    await page.locator(`[data-scoring-run-id="${config.syntheticRunId}"]`).waitFor();
    if (
      await page
        .getByRole("button", { name: /start evaluation|run evaluation|switch.*haiku/i })
        .count()
    )
      fail("unexpected-controls");
    await record("analytics-links-to-read-only-evaluations-with-read-error-recovery");
    const pending = await read(`/api/score-evaluations/${config.pendingRunId}/report`);
    const synthetic = await read(`/api/score-evaluations/${config.syntheticRunId}/report`);
    if (
      pending.totalCases < 1 ||
      pending.unrunCases !== pending.totalCases ||
      pending.measuredPairs !== 0 ||
      synthetic.totalCases < 2 ||
      synthetic.validPairs < 1 ||
      synthetic.measuredPairs !== 0 ||
      synthetic.excludedPairs !== synthetic.validPairs
    )
      fail("fixture-invalid");
    step = "list-pagination";
    await page.goto(`${config.webUrl}/analytics/scoring?pageSize=1`, {
      waitUntil: "domcontentloaded",
    });
    const listFirst = await read("/api/score-evaluations?page=1&limit=1");
    await page.locator(`[data-scoring-run-id="${listFirst.items[0].id}"]`).waitFor();
    await page.getByRole("button", { name: "Go to next page", exact: true }).click();
    const listSecond = await read("/api/score-evaluations?page=2&limit=1");
    await page.locator(`[data-scoring-run-id="${listSecond.items[0].id}"]`).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-scoring-run-id="${listSecond.items[0].id}"]`).waitFor();
    if (
      new URL(page.url()).searchParams.get("page") !== "2" ||
      (await page.locator("[data-scoring-run-id]").count()) !== 1
    )
      fail("pagination-invalid");
    await record("evaluation-list-pagination-persists-after-refresh");
    stage = "pending-report";
    step = "pending-metrics";
    await page.goto(`${config.webUrl}/analytics/scoring/${config.pendingRunId}`, {
      waitUntil: "domcontentloaded",
    });
    const pendingPanel = await counts(pending);
    await pendingPanel
      .getByRole("heading", { name: "Awaiting approved run", exact: true })
      .waitFor();
    const pendingMetrics = pendingPanel.getByRole("table", { name: "Scoring comparison metrics" });
    if (
      (await pendingMetrics.getByRole("cell", { name: "Not measured", exact: true }).count()) !== 18
    )
      fail("count-mismatch");
    await page.getByText("candidate: Unrun", { exact: true }).first().waitFor();
    await record("unrun-provider-comparison-shows-not-measured-instead-of-zero");
    stage = "synthetic-report";
    step = "excluded-synthetic-comparisons";
    await page.goto(`${config.webUrl}/analytics/scoring/${config.syntheticRunId}?pageSize=1`, {
      waitUntil: "domcontentloaded",
    });
    const syntheticPanel = await counts(synthetic);
    await syntheticPanel
      .getByRole("heading", { name: "Provider comparison not measured", exact: true })
      .waitFor();
    const measuredHeader = syntheticPanel.getByRole("columnheader", {
      name: "Measured provider pairs (0)",
      exact: true,
    });
    await measuredHeader.waitFor();
    for (const row of await syntheticPanel.locator("[data-scoring-metric]").all())
      if ((await row.getByRole("cell").last().textContent()) !== "Not measured")
        fail("count-mismatch");
    await record("synthetic-pairs-remain-excluded-from-provider-measurements");
    step = "exact-case-provenance";
    const firstCases = await read(
      `/api/score-evaluations/${config.syntheticRunId}/cases?page=1&limit=1`,
    );
    const first = firstCases.items[0];
    const firstCard = page.locator(`[data-scoring-case-id="${first.id}"]`);
    await firstCard.getByRole("heading", { name: first.context.job.title, exact: true }).waitFor();
    await firstCard.getByText(`Context SHA-256: ${first.contextHash}`, { exact: true }).waitFor();
    await firstCard
      .getByRole("button", { name: "Immutable inputs and eligibility evidence", exact: true })
      .click();
    await firstCard
      .getByText(`Original source SHA-256: ${first.context.basis.sourceSha256}`, { exact: true })
      .waitFor();
    if (first.results.some((result) => result.origin === "local_inference"))
      fail("fixture-invalid");
    for (const result of first.results)
      await firstCard
        .locator(
          `[data-scoring-slot="${result.slot}"][data-scoring-result-origin="${result.origin}"]`,
        )
        .waitFor();
    await record("case-details-preserve-original-source-and-result-provenance");
    step = "case-pagination-and-persistence";
    await page.getByRole("button", { name: "Go to next page", exact: true }).click();
    const secondCases = await read(
      `/api/score-evaluations/${config.syntheticRunId}/cases?page=2&limit=1`,
    );
    await page.locator(`[data-scoring-case-id="${secondCases.items[0].id}"]`).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-scoring-case-id="${secondCases.items[0].id}"]`).waitFor();
    await counts(synthetic);
    if (
      new URL(page.url()).searchParams.get("page") !== "2" ||
      (await page.locator("[data-scoring-case-id]").count()) !== 1
    )
      fail("pagination-invalid");
    if (
      JSON.stringify(await read(`/api/score-evaluations/${config.syntheticRunId}/report`)) !==
      JSON.stringify(synthetic)
    )
      fail("report-mutated");
    await record("case-pagination-persists-with-run-wide-denominators-and-unchanged-evidence");
    stage = "audit";
    step = "browser-and-request-audit";
    if (
      blockedRequests.some(
        (entry) =>
          !(
            entry.method === "GET" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(entry.hostname) &&
            ["/queue/status"].includes(entry.pathname) &&
            ![config.webUrl, config.apiUrl].includes(entry.origin)
          ),
      )
    )
      fail("unexpected-request");
    if (
      diagnosticsTruncated ||
      diagnostics.some(
        (entry) =>
          entry.kind === "pageerror" ||
          (entry.kind === "error" &&
            !(
              entry.message.startsWith("Failed to load resource:") &&
              [...(expectedResources.get(entry.resource) ?? [])].some((status) =>
                entry.message.includes(status),
              )
            )),
      )
    )
      fail("browser-error");
    await record("read-only-evaluation-flow-performs-no-model-or-application-writes");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        apiWrites: 0,
        authRequests,
        diagnosticRequests,
        diagnosticsTruncated,
        observations,
        blockedRequests,
        diagnostics,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    if (new URL(page.url()).pathname !== "/login")
      try {
        screenshot = (
          await page.screenshot({
            fullPage: true,
            mask: [page.locator("input"), page.locator("textarea")],
          })
        ).toString("base64");
      } catch {}
    const known = Object.hasOwn(failureMessages, error?.code);
    let code = "observer-error";
    if (error?.name === "TimeoutError") code = "ui-timeout";
    if (known) code = error.code;
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        modelCalls: 0,
        apiWrites: 0,
        failure: {
          stage,
          step,
          code,
          message: known
            ? failureMessages[error.code]
            : "The expected read-only UI state was not observed.",
          ...(screenshot ? { screenshot } : {}),
        },
        authRequests,
        diagnosticRequests,
        diagnosticsTruncated,
        observations,
        blockedRequests,
        diagnostics,
        screenshots,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observeScoringUi(environment, config) {
  assertLoopbackOrigins(
    [config.webUrl, config.apiUrl, config.cdpUrl],
    "Scoring UI regression requires loopback origins",
  );
  if (
    ![config.pendingRunId, config.syntheticRunId].every((id) =>
      /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id),
    ) ||
    config.pendingRunId === config.syntheticRunId
  )
    throw new Error("Scoring UI regression requires exact distinct fixture runs");
  const { outputDir, ...guestConfig } = config;
  const script = `const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; const scoringUiRequestAllowed = ${scoringUiRequestAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
