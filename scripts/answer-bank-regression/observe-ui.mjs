import {
  assertLoopbackOrigins,
  questionsUiDiagnosticAllowed,
  questionsUiRequestAllowed,
  runGuestObserver,
} from "../questions-regression/observe-ui.mjs";

export function answerBankUiRequestAllowed(method, address, body, config) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (
    ["GET", "HEAD", "OPTIONS"].includes(method) ||
    ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname)
  )
    return questionsUiRequestAllowed(method, address, body, { ...config, questions: [] });
  if (
    method !== "POST" ||
    url.origin !== config.apiUrl ||
    url.username ||
    url.password ||
    url.search ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return false;
  let parsed;
  try {
    parsed = JSON.parse(body ?? "null");
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  const keys = (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort().join(",")
      : "";
  const revision = Number.isInteger(parsed.expectedRevision) && parsed.expectedRevision > 0;
  if (url.pathname === `/api/answer-bank/${config.entryId}/revoke`)
    return (
      keys(parsed) === "expectedRevision,requestId" &&
      uuid.test(parsed.requestId) &&
      parsed.expectedRevision === config.entryRevision
    );
  const target = `/api/application-questions/${config.questionId}`;
  const targetCountry =
    parsed.countryCode === config.countryCode && parsed.countryConfirmed === true;
  if (url.pathname === `${target}/answer-matches`)
    return (
      keys(parsed) === "countryCode,countryConfirmed,expectedDefinitionHash,expectedRevision" &&
      revision &&
      /^[a-f0-9]{64}$/.test(parsed.expectedDefinitionHash) &&
      targetCountry
    );
  const common =
    parsed.confirmed === true &&
    uuid.test(parsed.requestId) &&
    revision &&
    /^[a-f0-9]{64}$/.test(parsed.expectedDefinitionHash) &&
    Array.isArray(parsed.values) &&
    parsed.values.length === 1 &&
    keys(parsed.values[0]) === "fieldKey,value";
  if (!common) return false;
  if (url.pathname === `${target}/answers`)
    return (
      keys(parsed) ===
        "confirmed,expectedDefinitionHash,expectedRevision,requestId,useSavedAnswer,values" &&
      parsed.values[0].fieldKey === config.fieldKey &&
      parsed.values[0].value === config.mappedValue &&
      keys(parsed.useSavedAnswer) === "countryCode,countryConfirmed,entryId,revision" &&
      parsed.useSavedAnswer.entryId === config.entryId &&
      parsed.useSavedAnswer.revision === config.entryRevision &&
      parsed.useSavedAnswer.countryCode === config.countryCode &&
      parsed.useSavedAnswer.countryConfirmed === true
    );
  if (url.pathname === `/api/application-questions/${config.saveQuestionId}/answers`)
    return (
      keys(parsed) ===
        "confirmed,expectedDefinitionHash,expectedRevision,requestId,saveToProfile,values" &&
      parsed.values[0].fieldKey === config.saveFieldKey &&
      parsed.values[0].value === config.saveValue &&
      keys(parsed.saveToProfile) === "consent,scope" &&
      parsed.saveToProfile.consent === true &&
      parsed.saveToProfile.scope === "employer"
    );
  return false;
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
    answers = [];
  const expectedResourceErrors = new Set();
  let diagnosticsTruncated = false,
    diagnosticRequests = 0,
    stage = "login",
    injectStale = true,
    injectBankListError = true,
    injectHistoryError = true,
    matchRequests = 0,
    revokeRequests = 0;
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
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (questionsUiDiagnosticAllowed(request.method(), request.url(), request.postData(), config)) {
      diagnosticRequests++;
      await route.continue();
      return;
    }
    if (!answerBankUiRequestAllowed(request.method(), request.url(), request.postData(), config)) {
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
      request.method() === "GET" &&
      url.origin === config.apiUrl &&
      ((stage === "saved-list-error" &&
        injectBankListError &&
        /^\/api\/answer-bank\/?$/.test(url.pathname)) ||
        (injectHistoryError && url.pathname === `/api/answer-bank/${config.entryId}`))
    ) {
      expectedResourceErrors.add(resourceKey(request.url()));
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic saved-answer read outage" }),
        headers: {
          "access-control-allow-origin": config.webUrl,
          "access-control-allow-credentials": "true",
        },
      });
      return;
    }
    if (request.method() === "POST") {
      if (url.pathname.endsWith("/answer-matches")) matchRequests++;
      if (url.pathname.endsWith("/revoke")) revokeRequests++;
      if (url.pathname.endsWith("/answers")) {
        const body = JSON.parse(request.postData());
        answers.push({
          questionId: url.pathname.split("/").at(-2),
          requestId: body.requestId,
          revision: body.expectedRevision,
        });
        if (url.pathname.includes(config.questionId) && injectStale) {
          injectStale = false;
          expectedResourceErrors.add(resourceKey(request.url()));
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              message: "Synthetic saved-answer revision conflict; review before reuse.",
            }),
            headers: {
              "access-control-allow-origin": config.webUrl,
              "access-control-allow-credentials": "true",
            },
          });
          return;
        }
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
  const factualLabel = "I confirm this answer is accurate for this application.";
  const target = page.locator(`[data-application-question-id="${config.questionId}"]`);
  async function useSaved() {
    await target.getByRole("button", { name: "Find saved answers", exact: true }).click();
    await target.getByRole("button", { name: "Use saved answer", exact: true }).click();
    if (await target.getByRole("checkbox", { name: factualLabel, exact: true }).isChecked())
      throw new Error("Saved answer confirmed itself");
    const canonical = await read(`/api/jobs/${config.jobId}/questions`);
    const field = canonical.questions
      .find((q) => q.id === config.questionId)
      .definition.fields.find((f) => f.key === config.fieldKey);
    const label = field.options.find((option) => option.value === config.mappedValue)?.label;
    if (
      !label ||
      (
        await target
          .getByRole("combobox", { name: field.label || config.questionPrompt, exact: true })
          .textContent()
      ).trim() !== label
    )
      throw new Error("Saved option was not mapped into the target draft");
  }
  try {
    await page.goto(`${config.webUrl}/login?next=/needs-you`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/needs-you`, { timeout: 60_000 });
    stage = "country-context";
    await count(config.initialCount);
    await target.getByRole("heading", { name: config.questionPrompt, exact: true }).waitFor();
    if (await target.getByRole("button", { name: "Find saved answers", exact: true }).isEnabled())
      throw new Error("Sensitive reuse allowed an unknown country");
    if (matchRequests || answers.length)
      throw new Error("Page automatically requested or used a saved answer");
    await target
      .getByRole("combobox", { name: "Country this question concerns", exact: true })
      .click();
    await page.getByRole("option", { name: "Canada", exact: true }).click();
    if (await target.getByRole("button", { name: "Find saved answers", exact: true }).isEnabled())
      throw new Error("Country selection did not require confirmation");
    await target
      .getByRole("checkbox", {
        name: "I confirm this question concerns the selected country.",
        exact: true,
      })
      .check();
    await record("sensitive-reuse-requires-explicit-country");
    stage = "draft-only-reuse";
    await useSaved();
    if (
      answers.length ||
      (await read(`/api/work-queue/${config.workItemId}`)).item.state !== "needs_user"
    )
      throw new Error("Draft reuse changed queue or confirmed an answer");
    await count(config.initialCount);
    await record("saved-answer-maps-only-into-unconfirmed-draft");
    stage = "stale-recovery";
    await target.getByRole("checkbox", { name: factualLabel, exact: true }).check();
    await target.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
    await target.getByRole("button", { name: "Review updated question", exact: true }).waitFor();
    if (
      answers.length !== 1 ||
      (await target.getByRole("button", { name: "Save confirmed answer", exact: true }).isEnabled())
    )
      throw new Error("Stale reuse retried without explicit review");
    await record("stale-saved-revision-requires-explicit-review");
    await target.getByRole("button", { name: "Review updated question", exact: true }).click();
    await useSaved();
    await target.getByRole("checkbox", { name: factualLabel, exact: true }).check();
    await target.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
    await count(config.initialCount - 1);
    if ((await read(`/api/work-queue/${config.workItemId}`)).item.state !== "queued")
      throw new Error("Confirmed reuse did not release safe queued work");
    const targetBeforeRevoke = (await read(`/api/jobs/${config.jobId}/questions`)).questions.find(
      (q) => q.id === config.questionId,
    ).answer;
    if (!targetBeforeRevoke?.confirmedAt)
      throw new Error("Current application answer lacks confirmation");
    await record("human-confirmed-reuse-persists-and-releases-queue");
    stage = "atomic-save";
    const contact = page.locator(`[data-application-question-id="${config.saveQuestionId}"]`);
    const source = await read(`/api/jobs/${config.saveJobId}/questions`);
    const contactField = source.questions
      .find((q) => q.id === config.saveQuestionId)
      .definition.fields.find((f) => f.key === config.saveFieldKey);
    await contact
      .getByRole("textbox", { name: contactField.label || config.saveQuestionPrompt, exact: true })
      .fill(config.saveValue);
    await contact
      .getByRole("checkbox", {
        name: "Save this confirmed answer to profile for matching questions.",
        exact: true,
      })
      .check();
    if (await contact.getByRole("checkbox", { name: factualLabel, exact: true }).isChecked())
      throw new Error("Save consent implied factual confirmation");
    await contact.getByRole("checkbox", { name: factualLabel, exact: true }).check();
    await contact.getByRole("button", { name: "Save confirmed answer", exact: true }).click();
    await count(0);
    const bank = await read("/api/answer-bank?page=1&limit=25&status=all");
    const saved = bank.items.filter((entry) => entry.sourceQuestionId === config.saveQuestionId);
    if (
      bank.pagination.total !== 2 ||
      saved.length !== 1 ||
      saved[0].scope !== "employer" ||
      !saved[0].sourceConfirmedAt ||
      !saved[0].consentedAt ||
      saved[0].sourceValues.length !== 1 ||
      saved[0].sourceValues[0].value !== config.saveValue
    )
      throw new Error("Atomic source answer and bank consent were not persisted exactly once");
    await record("explicit-profile-consent-saves-with-confirmed-source");
    stage = "saved-list-error";
    await page.goto(`${config.webUrl}/settings/answers?historyPage=2`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Saved answers", exact: true }).waitFor();
    const listError = page.getByRole("alert").filter({ hasText: "Could not load saved answers." });
    await listError.waitFor({ timeout: 60_000 });
    await record("saved-list-read-error-is-visible-and-recoverable");
    injectBankListError = false;
    await listError.getByRole("button", { name: "Retry saved answers", exact: true }).click();
    await page.locator(`[data-answer-bank-entry-id="${saved[0].id}"]`).waitFor();
    stage = "history-error";
    await page
      .locator(`[data-answer-bank-entry-id="${config.entryId}"]`)
      .getByRole("button", { name: "View answer history", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Saved answer history", exact: true });
    const historyError = dialog
      .getByRole("alert")
      .filter({ hasText: "Could not load this saved answer." });
    await historyError.waitFor({ timeout: 60_000 });
    if (new URL(page.url()).searchParams.has("historyPage"))
      throw new Error("Opening an entry retained another history page");
    await record("history-resets-page-and-recovers-from-read-error");
    injectHistoryError = false;
    await historyError.getByRole("button", { name: "Retry history", exact: true }).click();
    stage = "history";
    await dialog.getByRole("heading", { name: "Revision history", exact: true }).waitFor();
    await dialog
      .getByRole("link", { name: "Review or correct the source application answer", exact: true })
      .waitFor();
    const history = await read(`/api/answer-bank/${config.entryId}?page=1&limit=1`);
    if (
      history.entry.sourceQuestionId !== config.sourceQuestionId ||
      history.entry.sourceAnswerId !== config.sourceAnswerId ||
      history.revisions.pagination.total !== 1
    )
      throw new Error("History provenance or pagination missing");
    await record("saved-history-shows-confirmed-source-and-revision");
    stage = "revoke";
    await dialog.getByRole("button", { name: "Revoke saved answer", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Revoke saved answer", exact: true })
      .waitFor({ state: "hidden" });
    const revoked = await read(`/api/answer-bank/${config.entryId}?page=1&limit=1`);
    if (
      revoked.entry.action !== "revoke" ||
      revoked.entry.available ||
      revoked.revisions.pagination.total !== 2 ||
      revoked.entry.revision !== config.entryRevision + 1
    )
      throw new Error("Revocation did not preserve revision history");
    await record("revocation-prevents-future-reuse-and-preserves-history");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("combobox", { name: "Saved answer status", exact: true }).click();
    await page.getByRole("option", { name: "Revoked", exact: true }).click();
    await page.locator(`[data-answer-bank-entry-id="${config.entryId}"]`).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-answer-bank-entry-id="${config.entryId}"]`).waitFor();
    const targetAfterRevoke = (await read(`/api/jobs/${config.jobId}/questions`)).questions.find(
      (q) => q.id === config.questionId,
    ).answer;
    if (
      JSON.stringify(targetAfterRevoke) !== JSON.stringify(targetBeforeRevoke) ||
      (await read(`/api/work-queue/${config.workItemId}`)).item.state !== "queued"
    )
      throw new Error("Revocation altered an already-confirmed application");
    if (answers.length !== 3 || matchRequests !== 2 || revokeRequests !== 1)
      throw new Error("Unexpected action count");
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
    if (blockedRequests.some((item) => !["GET", "HEAD", "OPTIONS"].includes(item.method)))
      throw new Error("UI attempted an unauthorized mutation");
    await record("revocation-persists-without-changing-existing-application");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        observations,
        blockedRequests,
        diagnostics,
        diagnosticsTruncated,
        diagnosticRequests,
        answerRequests: answers.length,
        matchRequests,
        revokeRequests,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    if (["/needs-you", "/settings/answers"].includes(new URL(page.url()).pathname)) {
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
        diagnosticsTruncated,
        diagnosticRequests,
        answerRequests: answers.length,
        matchRequests,
        revokeRequests,
        screenshots,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observeAnswerBankUi(environment, config) {
  assertLoopbackOrigins(
    [config.webUrl, config.apiUrl, config.cdpUrl],
    "Answer-bank UI regression requires loopback origins",
  );
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (
    ![
      config.jobId,
      config.workItemId,
      config.questionId,
      config.entryId,
      config.sourceJobId,
      config.sourceQuestionId,
      config.sourceAnswerId,
      config.saveJobId,
      config.saveQuestionId,
    ].every((id) => uuid.test(id)) ||
    config.initialCount !== 2 ||
    config.countryCode !== "CA" ||
    config.fieldKey !== "target-work-right" ||
    config.mappedValue !== "allowed" ||
    config.saveFieldKey !== "contact_email" ||
    config.saveValue !== "bank.fixture@questions.example.test" ||
    !Number.isInteger(config.entryRevision) ||
    config.entryRevision < 1
  )
    throw new Error("Answer-bank regression requires the exact synthetic fixture scope");
  const { outputDir, ...guestConfig } = config;
  const script = `const questionsUiRequestAllowed = ${questionsUiRequestAllowed.toString()}; const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; const answerBankUiRequestAllowed = ${answerBankUiRequestAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
