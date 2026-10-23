import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function questionsUiDiagnosticAllowed(method, address, body, config) {
  try {
    const url = new URL(address);
    const parsed = JSON.parse(body ?? "null");
    return (
      method === "POST" &&
      url.origin === config.webUrl &&
      !url.username &&
      !url.password &&
      !url.search &&
      url.pathname === "/__nextjs_original-stack-frames" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      body.length <= 65_536 &&
      parsed &&
      Object.keys(parsed).sort().join(",") === "frames,isAppDirectory,isEdgeServer,isServer" &&
      [parsed.isAppDirectory, parsed.isEdgeServer, parsed.isServer].every(
        (value) => typeof value === "boolean",
      ) &&
      Array.isArray(parsed.frames) &&
      parsed.frames.length <= 100
    );
  } catch {
    return false;
  }
}

export function questionsUiRequestAllowed(method, address, body, config) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (![config.webUrl, config.apiUrl].includes(url.origin) || url.username || url.password)
    return false;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  if (url.pathname.startsWith("/__nextjs_"))
    return (
      url.origin === config.webUrl &&
      ["GET", "HEAD"].includes(method) &&
      url.pathname === "/__nextjs_font/geist-latin.woff2" &&
      !url.search
    );
  if (
    /\/(inference|sessions|providers|submit|pilot\/(start|tick)|work-queue\/(claim|schedule))\b/.test(
      url.pathname,
    )
  )
    return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (method !== "POST" || url.origin !== config.apiUrl) return false;
  if (["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname))
    return true;
  let parsed;
  try {
    parsed = JSON.parse(body ?? "null");
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  if (url.pathname === `/api/pilot/questions/${config.operationalQuestionId}/answer`)
    return Object.keys(parsed).length === 1 && ["Approve", "Skip"].includes(parsed.answer);
  const question = config.questions.find(
    (item) => url.pathname === `/api/application-questions/${item.id}/answers`,
  );
  if (!question) return false;
  return (
    Object.keys(parsed).sort().join(",") ===
      "confirmed,expectedDefinitionHash,expectedRevision,requestId,values" &&
    parsed.confirmed === true &&
    Number.isInteger(parsed.expectedRevision) &&
    parsed.expectedRevision > 0 &&
    /^[a-f0-9]{64}$/.test(parsed.expectedDefinitionHash) &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(parsed.requestId) &&
    Array.isArray(parsed.values) &&
    parsed.values.length === 1 &&
    Object.keys(parsed.values[0]).sort().join(",") === "fieldKey,value" &&
    parsed.values[0].fieldKey === question.fieldKey &&
    typeof parsed.values[0].value === "string" &&
    (question.fieldKey === "sponsorshipDetails"
      ? parsed.values[0].value === "Synthetic confirmed authorization detail"
      : ["yes", "no"].includes(parsed.values[0].value))
  );
}

export function assertLoopbackOrigins(values, message) {
  for (const value of values) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(message);
  }
}

export async function runGuestObserver(environment, script, outputDir) {
  const directory = resolve(outputDir);
  await mkdir(directory, { recursive: true });
  const result = JSON.parse(
    await environment.guestCommand(["node", "--input-type=module"], {
      input: script,
      timeout: 300_000,
    }),
  );
  for (const entry of result.screenshots) {
    const filename = join(directory, `${entry.name}.png`);
    await writeFile(filename, Buffer.from(entry.screenshot, "base64"));
    entry.screenshot = filename;
  }
  if (result.failure?.screenshot) {
    const filename = join(directory, "failure.png");
    await writeFile(filename, Buffer.from(result.failure.screenshot, "base64"));
    result.failure.screenshot = filename;
  }
  await writeFile(join(directory, "observations.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
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
  const observations = [];
  const screenshots = [];
  const blockedRequests = [];
  const diagnostics = [];
  const expectedResourceErrors = new Set();
  let diagnosticsTruncated = false;
  let diagnosticRequests = 0;
  const answers = [];
  let injectListError = true;
  let injectStale = true;
  let injectSaveError = true;
  let stage = "login";
  function resourceKey(address) {
    try {
      const url = new URL(address);
      return `${url.origin}${url.pathname}`;
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
    diagnostics.push({ kind, stage, message: safe, resource: resourceKey(address) });
  }
  page.on("pageerror", (error) => diagnostic("pageerror", error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
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
      expectedResourceErrors.add(resourceKey(response.url()));
  });
  const cors = {
    "access-control-allow-origin": config.webUrl,
    "access-control-allow-credentials": "true",
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (questionsUiDiagnosticAllowed(request.method(), request.url(), request.postData(), config)) {
      diagnosticRequests++;
      await route.continue();
      return;
    }
    if (!questionsUiRequestAllowed(request.method(), request.url(), request.postData(), config)) {
      if (
        request.method() === "GET" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["/queue/status"].includes(url.pathname) &&
        ![config.apiUrl, config.webUrl].includes(url.origin)
      )
        expectedResourceErrors.add(resourceKey(request.url()));
      blockedRequests.push({
        method: request.method(),
        origin: url.origin,
        pathname: url.pathname,
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      injectListError &&
      request.method() === "GET" &&
      url.origin === config.apiUrl &&
      /^\/api\/needs-you\/?$/.test(url.pathname)
    ) {
      expectedResourceErrors.add(resourceKey(request.url()));
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic list outage" }),
        headers: cors,
      });
      return;
    }
    const question = config.questions.find(
      (item) => url.pathname === `/api/application-questions/${item.id}/answers`,
    );
    if (request.method() === "POST" && question) {
      const body = JSON.parse(request.postData());
      answers.push({ id: question.id, requestId: body.requestId, revision: body.expectedRevision });
      if (question.id === config.questions[0].id && injectStale) {
        injectStale = false;
        expectedResourceErrors.add(resourceKey(request.url()));
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic stale revision; refresh and review." }),
          headers: cors,
        });
        return;
      }
      if (question.id === config.questions[1].id && injectSaveError) {
        injectSaveError = false;
        expectedResourceErrors.add(resourceKey(request.url()));
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic save outage" }),
          headers: cors,
        });
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
  async function read(path) {
    return page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Fixture read failed");
      return response.json();
    }, `${config.apiUrl}${path}`);
  }
  async function count(expected) {
    await page.locator(`[data-needs-you-total="${expected}"]`).waitFor();
    await page.getByTitle(`${expected} items need you`, { exact: true }).first().waitFor();
  }
  async function choose(question, canonical) {
    const row = page.locator(`[data-application-question-id="${question.id}"]`);
    const field = canonical.questions
      .find((item) => item.id === question.id)
      .definition.fields.find((item) => item.key === question.fieldKey);
    const option =
      field.options.find((item) => item.label.toLowerCase() === "no") ?? field.options[0];
    if (!option) throw new Error("Fixture requires an explicit choice option");
    await row.getByRole("combobox", { name: field.label || question.prompt, exact: true }).click();
    await page.getByRole("option", { name: option.label, exact: true }).click();
    await row
      .getByRole("checkbox", {
        name: "I confirm this answer is accurate for this application.",
        exact: true,
      })
      .check();
    await row.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
    return row;
  }
  try {
    await page.goto(`${config.webUrl}/login?next=/needs-you`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/needs-you`, { timeout: 60_000 });
    stage = "read-error";
    await page.getByRole("heading", { name: "Needs you", exact: true }).waitFor();
    const loadError = page
      .getByRole("alert")
      .filter({ hasText: "Could not load your questions. No answers were changed." });
    await loadError.waitFor({ timeout: 60_000 });
    await record("visible-question-read-error");
    injectListError = false;
    await loadError.getByRole("button", { name: "Retry", exact: true }).click();
    stage = "unified-list";
    await count(config.initialCount);
    for (const question of config.questions) {
      const row = page.locator(`[data-application-question-id="${question.id}"]`);
      await row.getByRole("heading", { name: question.prompt, exact: true }).waitFor();
      if (await row.getByRole("button", { name: "Save confirmed answer" }).isEnabled())
        throw new Error("Unconfirmed answer can submit");
    }
    await page
      .locator(`[data-operational-question-id="${config.operationalQuestionId}"]`)
      .getByText(config.operationalPrompt, { exact: true })
      .waitFor();
    await record("unified-operational-application-and-exact-count");
    const canonical = await read(`/api/jobs/${config.jobId}/questions`);
    stage = "stale-answer";
    const first = await choose(config.questions[0], canonical);
    await first
      .getByText("The form changed or this revision could not be confirmed.", { exact: false })
      .waitFor();
    if (
      answers.length !== 1 ||
      (await first.getByRole("button", { name: "Save confirmed answer" }).isEnabled())
    )
      throw new Error("Stale answer retried without review");
    await count(config.initialCount);
    await record("stale-answer-requires-explicit-review");
    await first.getByRole("button", { name: "Review updated question", exact: true }).click();
    await choose(config.questions[0], canonical);
    await count(config.initialCount - 1);
    let queue = await read(`/api/work-queue/${config.workItemId}`);
    if (queue.item.state !== "needs_user")
      throw new Error("Queue resumed before every required answer");
    await record("first-answer-keeps-remaining-blocker");
    stage = "save-error";
    const second = await choose(config.questions[1], canonical);
    await second.getByRole("alert").filter({ hasText: "Synthetic save outage" }).waitFor();
    await record("save-error-preserves-draft");
    await second.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
    await count(config.initialCount - 2);
    const retries = answers.filter((item) => item.id === config.questions[1].id);
    if (retries.length !== 2 || retries[0].requestId !== retries[1].requestId)
      throw new Error("Save retry changed idempotency identity");
    queue = await read(`/api/work-queue/${config.workItemId}`);
    if (config.questions.length === 3) {
      if (queue.item.state !== "needs_user")
        throw new Error("Queue resumed before the conditional answer");
      stage = "hidden-known-answer";
      const child = config.questions[2];
      const definition = canonical.questions.find((item) => item.id === child.id)?.definition;
      if (definition?.visibility !== "hidden" || definition.condition.state !== "known")
        throw new Error("Conditional fixture is not an observed hidden known child");
      const row = page.locator(`[data-application-question-id="${child.id}"]`);
      await row
        .getByRole("alert")
        .filter({ hasText: "This field was hidden when observed and has a recorded condition." })
        .waitFor();
      await row
        .getByRole("textbox", { name: child.prompt, exact: true })
        .fill("Synthetic confirmed authorization detail");
      await row
        .getByRole("checkbox", {
          name: "I confirm this answer is accurate for this application.",
          exact: true,
        })
        .check();
      await row.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
      await count(config.initialCount - 3);
      queue = await read(`/api/work-queue/${config.workItemId}`);
      await record("hidden-known-conditional-answer-works-offline");
    }
    if (queue.item.state !== "queued")
      throw new Error("Resolved application blockers did not release safe queued work");
    await record("confirmed-answers-release-only-safe-queue-work");
    stage = "operational-answer";
    const operational = page.locator(
      `[data-operational-question-id="${config.operationalQuestionId}"]`,
    );
    await operational.getByRole("radio", { name: "Approve", exact: true }).check();
    await operational.getByRole("button", { name: "Send answer", exact: true }).click();
    await count(0);
    await page.getByText("No unanswered questions in this view.", { exact: true }).waitFor();
    await record("operational-answer-clears-unified-count");
    stage = "persisted";
    await page.reload({ waitUntil: "domcontentloaded" });
    await count(0);
    const saved = await read(`/api/jobs/${config.jobId}/questions`);
    for (const question of config.questions)
      if (!saved.questions.find((item) => item.id === question.id)?.answer?.confirmedAt)
        throw new Error("Answer was not persisted with confirmation");
    if (answers.length !== config.questions.length + 2)
      throw new Error("Unexpected answer retry count");
    stage = "browser-diagnostics";
    if (
      diagnosticsTruncated ||
      diagnostics.some(
        (entry) =>
          entry.kind === "pageerror" ||
          (entry.kind === "error" &&
            !(
              entry.message.startsWith("Failed to load resource:") &&
              expectedResourceErrors.has(entry.resource)
            )),
      )
    )
      throw new Error("Unexpected browser runtime or console error");
    const mutations = blockedRequests.filter(
      (item) => !["GET", "HEAD", "OPTIONS"].includes(item.method),
    );
    if (mutations.length) throw new Error("UI attempted an unauthorized mutation");
    await record("offline-confirmed-answers-persist-after-refresh");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        observations,
        blockedRequests,
        diagnostics,
        diagnosticRequests,
        diagnosticsTruncated,
        answerRequests: answers.length,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    if (new URL(page.url()).pathname === "/needs-you") {
      try {
        screenshot = (
          await page.screenshot({
            fullPage: true,
            mask: [page.locator("input"), page.locator("textarea")],
          })
        ).toString("base64");
      } catch {}
    }
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        modelCalls: 0,
        failure: {
          stage,
          errorClass: error?.name === "TimeoutError" ? "TimeoutError" : "Error",
          ...(screenshot ? { screenshot } : {}),
        },
        observations,
        blockedRequests,
        diagnostics,
        diagnosticRequests,
        diagnosticsTruncated,
        answerRequests: answers.length,
        screenshots,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observeQuestionsUi(environment, config) {
  for (const value of [config.webUrl, config.apiUrl, config.cdpUrl]) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new Error("Questions UI regression requires loopback origins");
  }
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (
    ![
      config.jobId,
      config.workItemId,
      config.operationalQuestionId,
      ...config.questions.map((item) => item.id),
    ].every((id) => uuid.test(id)) ||
    ![2, 3].includes(config.questions.length) ||
    config.initialCount !== config.questions.length + 1
  )
    throw new Error("Questions UI regression requires the exact three synthetic fixture questions");
  const { outputDir, ...guestConfig } = config;
  const script = `const questionsUiRequestAllowed = ${questionsUiRequestAllowed.toString()}; const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
