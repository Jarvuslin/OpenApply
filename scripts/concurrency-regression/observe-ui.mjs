import {
  assertLoopbackOrigins,
  questionsUiDiagnosticAllowed,
  runGuestObserver,
} from "../questions-regression/observe-ui.mjs";

export function concurrencyUiRequestAllowed(method, address, body, config) {
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
    ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout", "/api/work-queue/limits"].includes(
      url.pathname,
    )
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
  if (method === "PUT") {
    if (url.pathname !== "/api/work-queue/limits" || url.search) return false;
    try {
      const parsed = JSON.parse(body);
      return (
        Object.keys(parsed).sort().join(",") ===
          "companyApplicationCap,companyWindowDays,dailyApplicationCap,domainDelaySeconds,expectedRevision,maxConcurrentWorkers,requestId" &&
        /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(parsed.requestId) &&
        Number.isInteger(config.expectedRevision) &&
        parsed.expectedRevision === config.expectedRevision &&
        Object.entries(config.targetLimits).every(([key, value]) => parsed[key] === value)
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
      "/api/needs-you/count",
      "/api/needs-you/events",
      "/api/workspace/events",
      "/api/work-queue/events",
      "/api/work-queue/summary",
      "/api/work-queue/limits",
      "/api/work-queue/estimate",
    ].includes(url.pathname)
  )
    return !url.search;
  if (url.pathname !== "/api/work-queue") return false;
  return [...url.searchParams].every(
    ([key, value]) =>
      (["page", "limit"].includes(key) && /^[1-9]\d{0,3}$/.test(value)) ||
      (key === "state" && ["queued", "paused"].includes(value)),
  );
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
    diagnostics = [],
    policyRequests = [];
  const expectedResources = new Map();
  const guard = { ...config, expectedRevision: undefined };
  let stage = "login",
    step = "open-login",
    injectReadError = true,
    diagnosticRequests = 0,
    authRequests = 0,
    diagnosticsTruncated = false;
  const failureMessages = {
    "fixture-invalid":
      "The fixture needs at least two queued applications and an initialized policy.",
    "read-failed": "An owned queue read failed.",
    "count-mismatch": "The rendered estimate differs from the whole-queue API counts.",
    "policy-mismatch": "Saved limits or revision differ from the exact fixture update.",
    "retry-invalid": "A policy retry changed its identity or happened without an explicit click.",
    "pagination-invalid":
      "Queue pagination did not persist independently of the whole-queue estimate.",
    "unexpected-request": "The UI attempted a request outside its model-free fixture scope.",
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
    const key = resource(address),
      statuses = expectedResources.get(key) ?? new Set();
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
  function allowedOfflineProbe(entry) {
    return (
      entry.method === "GET" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(entry.hostname) &&
      ["/queue/status"].includes(entry.pathname) &&
      ![config.webUrl, config.apiUrl].includes(entry.origin)
    );
  }
  const headers = {
    "access-control-allow-origin": config.webUrl,
    "access-control-allow-credentials": "true",
  };
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (questionsUiDiagnosticAllowed(request.method(), request.url(), request.postData(), config)) {
      diagnosticRequests++;
      await route.continue();
      return;
    }
    if (!concurrencyUiRequestAllowed(request.method(), request.url(), request.postData(), guard)) {
      const entry = {
        method: request.method(),
        protocol: url.protocol,
        hostname: url.hostname,
        origin: url.origin,
        pathname: url.pathname,
      };
      if (allowedOfflineProbe(entry)) expectResource(request.url(), "ERR_BLOCKED_BY_CLIENT");
      blockedRequests.push(entry);
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "POST") authRequests++;
    if (
      injectReadError &&
      request.method() === "GET" &&
      url.origin === config.apiUrl &&
      url.pathname === "/api/work-queue/estimate"
    ) {
      injectReadError = false;
      expectResource(request.url(), "503");
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers,
        body: JSON.stringify({ message: "Synthetic read interruption" }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const body = JSON.parse(request.postData());
      policyRequests.push({ requestId: body.requestId, expectedRevision: body.expectedRevision });
      if (policyRequests.length === 1) {
        expectResource(request.url(), "409");
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          headers,
          body: JSON.stringify({ message: "Synthetic stale policy; reload saved limits." }),
        });
        return;
      }
      if (policyRequests.length === 2) {
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        expectResource(request.url(), "ERR_FAILED");
        await route.abort("failed");
        return;
      }
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
  async function counts(estimate) {
    const panel = page.locator(`[data-queue-estimate-revision="${estimate.policy.revision}"]`);
    for (const [key, label] of Object.entries({
      queuedApplications: "Queued applications",
      activeWorkers: "Active workers",
      heldReservations: "Held reservations",
      consumedReservations: "Consumed reservations",
      submittedToday: "Submitted today",
      eligibleNow: "Eligible now",
      deferred: "Deferred",
    })) {
      const rendered = panel.locator(`[data-queue-estimate-count="${key}"]`);
      await rendered.waitFor();
      if ((await rendered.textContent()) !== `${label}: ${estimate.counts[key]}`)
        fail("count-mismatch");
    }
    await panel.locator('[data-queue-usage="unavailable"]').waitFor();
    if (
      Object.entries(estimate.usage).some(([key, value]) => key !== "provenance" && value !== null)
    )
      fail("fixture-invalid");
  }
  async function fillLimits() {
    for (const [key, label] of Object.entries({
      maxConcurrentWorkers: "Maximum workers",
      dailyApplicationCap: "Applications per day",
      companyApplicationCap: "Applications per company",
      companyWindowDays: "Company window (days)",
      domainDelaySeconds: "Domain spacing (seconds)",
    }))
      await page
        .getByRole("spinbutton", { name: label, exact: true })
        .fill(String(config.targetLimits[key]));
  }
  function assertLimits(limits) {
    if (
      limits.revision !== guard.expectedRevision + 1 ||
      Object.entries(config.targetLimits).some(([key, value]) => limits[key] !== value)
    )
      fail("policy-mismatch");
  }
  try {
    await page.goto(`${config.webUrl}/login?next=/queue`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/queue`, { timeout: 60_000 });
    stage = "queue";
    step = "recover-estimate-read-error";
    await page.getByRole("heading", { name: "Queue", exact: true }).waitFor();
    await page.getByText("Could not load the queue estimate.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry estimate", exact: true }).click();
    const initial = await read("/api/work-queue/limits"),
      estimate = await read("/api/work-queue/estimate");
    guard.expectedRevision = initial.revision;
    if (initial.revision < 1 || estimate.counts.queuedApplications < 2) fail("fixture-invalid");
    await counts(estimate);
    await page.getByText("This computer is offline.", { exact: false }).waitFor();
    await record("offline-queue-shows-whole-queue-estimate-with-read-error-recovery");
    stage = "policy";
    step = "stale-policy-recovery";
    await page.getByRole("button", { name: "Edit queue limits", exact: true }).click();
    await fillLimits();
    await page.getByRole("button", { name: "Save queue limits", exact: true }).click();
    await page.getByRole("button", { name: "Reload saved limits", exact: true }).click();
    await page.getByRole("button", { name: "Save queue limits", exact: true }).waitFor();
    await record("stale-policy-requires-explicit-reload-before-another-save");
    step = "lost-acknowledgement";
    await fillLimits();
    await page.getByRole("button", { name: "Save queue limits", exact: true }).click();
    await page.getByRole("button", { name: "Retry same save", exact: true }).waitFor();
    const committed = await read("/api/work-queue/limits");
    assertLimits(committed);
    if (policyRequests.length !== 2) fail("retry-invalid");
    await record("lost-save-acknowledgement-keeps-the-exact-request-pending");
    step = "manual-idempotent-retry";
    await page.getByRole("button", { name: "Retry same save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    if (
      policyRequests.length !== 3 ||
      policyRequests[1].requestId !== policyRequests[2].requestId ||
      policyRequests[1].expectedRevision !== policyRequests[2].expectedRevision
    )
      fail("retry-invalid");
    assertLimits(await read("/api/work-queue/limits"));
    await page.locator(`[data-queue-limits-revision="${committed.revision}"]`).waitFor();
    await record("explicit-retry-reuses-request-id-without-another-policy-revision");
    stage = "pagination";
    step = "page-independent-estimate";
    await page.goto(`${config.webUrl}/queue?pageSize=1&state=queued`, {
      waitUntil: "domcontentloaded",
    });
    const first = await read("/api/work-queue?page=1&limit=1&state=queued");
    await page.locator(`[data-work-item-id="${first.items[0].id}"]`).waitFor();
    await counts(await read("/api/work-queue/estimate"));
    await page.getByRole("button", { name: "Go to next page", exact: true }).click();
    const second = await read("/api/work-queue?page=2&limit=1&state=queued");
    await page.locator(`[data-work-item-id="${second.items[0].id}"]`).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-work-item-id="${second.items[0].id}"]`).waitFor();
    if (
      new URL(page.url()).searchParams.get("page") !== "2" ||
      (await page.locator("[data-work-item-id]").count()) !== 1
    )
      fail("pagination-invalid");
    assertLimits(await read("/api/work-queue/limits"));
    await counts(await read("/api/work-queue/estimate"));
    await record("policy-and-pagination-persist-with-whole-queue-estimate");
    step = "filter-independent-estimate";
    await page.goto(`${config.webUrl}/queue?state=paused`, { waitUntil: "domcontentloaded" });
    await counts(await read("/api/work-queue/estimate"));
    await record("status-filter-does-not-reduce-whole-queue-estimate");
    stage = "audit";
    step = "browser-and-request-audit";
    if (blockedRequests.some((entry) => !allowedOfflineProbe(entry))) fail("unexpected-request");
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
    if (policyRequests.length !== 3) fail("retry-invalid");
    await record("policy-only-flow-performs-no-model-claim-or-application-writes");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        policyRequests,
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
    let code = error?.name === "TimeoutError" ? "ui-timeout" : "observer-error";
    if (known) code = error.code;
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        modelCalls: 0,
        failure: {
          stage,
          step,
          code,
          message: known
            ? failureMessages[error.code]
            : "The expected model-free queue state was not observed.",
          ...(screenshot ? { screenshot } : {}),
        },
        policyRequests,
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

export async function observeConcurrencyUi(environment, config) {
  assertLoopbackOrigins(
    [config.webUrl, config.apiUrl, config.cdpUrl],
    "Concurrency UI regression requires loopback origins",
  );
  const bounds = {
    maxConcurrentWorkers: [1, 3],
    dailyApplicationCap: [1, 500],
    companyApplicationCap: [1, 100],
    companyWindowDays: [1, 90],
    domainDelaySeconds: [1, 3600],
  };
  if (
    !config.targetLimits ||
    Object.keys(config.targetLimits).sort().join(",") !== Object.keys(bounds).sort().join(",") ||
    Object.entries(bounds).some(
      ([key, [min, max]]) =>
        !Number.isInteger(config.targetLimits[key]) ||
        config.targetLimits[key] < min ||
        config.targetLimits[key] > max,
    )
  )
    throw new Error("Concurrency UI regression requires exact finite fixture limits");
  const { outputDir, ...guestConfig } = config;
  const script = `const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; const concurrencyUiRequestAllowed = ${concurrencyUiRequestAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
