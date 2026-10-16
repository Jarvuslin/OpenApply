import {
  assertLoopbackOrigins,
  questionsUiDiagnosticAllowed,
  questionsUiRequestAllowed,
  runGuestObserver,
} from "../questions-regression/observe-ui.mjs";
import { preparationUiPdfResourceAllowed, preparationUiResourceKey } from "./pdf-viewer.mjs";

export function preparationUiFixtureQuestion(canonical, config) {
  if (
    canonical?.job?.id !== config.jobId ||
    !Number.isInteger(canonical.collectionVersion) ||
    canonical.collectionVersion < 1 ||
    !Array.isArray(canonical.questions)
  )
    throw new Error("Canonical fixture job or collection identity is invalid");
  const question = canonical.questions.find((item) => item.id === config.questionId);
  if (!question) throw new Error("Canonical fixture question is missing");
  if (question.current !== true || question.jobId !== config.jobId)
    throw new Error("Canonical fixture question is not current and owned by the fixture job");
  if (question.blocking !== true) throw new Error("Canonical fixture question is not blocking");
  if (
    !question.definition?.fields?.some(
      (field) => field.key === config.fileFieldKey && field.type === "file",
    )
  )
    throw new Error("Canonical fixture upload field is missing");
  if (question.answer !== null) throw new Error("Canonical fixture question already has an answer");
  return question;
}

export function preparationUiFailure(error) {
  const known = {
    "Canonical fixture job or collection identity is invalid": "fixture-collection-invalid",
    "Canonical fixture question is missing": "fixture-question-missing",
    "Canonical fixture question is not current and owned by the fixture job":
      "fixture-question-stale",
    "Canonical fixture question is not blocking": "fixture-question-not-blocking",
    "Canonical fixture upload field is missing": "fixture-upload-missing",
    "Canonical fixture question already has an answer": "fixture-answer-present",
    "A file-only question exposes a factual filename answer action": "filename-answer-action",
    "Opening file question performed an automatic mutation": "automatic-mutation",
    "Owned synthetic resume missing": "fixture-resume-missing",
    "PDF preview implied upload consent": "implicit-document-consent",
    "PDF selection did not persist separately from factual answers": "document-selection-invalid",
    "Resolved document requirement did not safely release queued work": "queue-still-blocked",
    "Real companion preparation failed": "companion-request-failed",
    "Real preparation result did not preserve preview boundaries": "preview-boundary-invalid",
    "Readback did not verify the selected PDF bytes": "pdf-readback-mismatch",
    "Optional omission fabricated a factual value": "omission-invented-value",
    "Preparation changed confirmed document identity or execution state": "preview-mutated-state",
    "Unexpected mutation count": "unexpected-action-count",
    "Unexpected browser runtime or console error": "browser-runtime-error",
    "UI attempted an unauthorized mutation": "unauthorized-mutation",
  };
  const message = typeof error?.message === "string" ? error.message : "";
  if (Object.hasOwn(known, message)) return { code: known[message], message };
  if (message.includes("strict mode violation"))
    return { code: "locator-ambiguous", message: "The UI locator matched multiple elements." };
  if (message.includes("Fixture read failed"))
    return { code: "fixture-read-failed", message: "An owned fixture API read failed." };
  if (error?.name === "TimeoutError")
    return {
      code: "ui-timeout",
      message: "The expected UI state did not appear before the deadline.",
    };
  return { code: "unexpected-error", message: "The observer failed at the recorded step." };
}

export function preparationUiRequestAllowed(method, address, body, config) {
  if (preparationUiPdfResourceAllowed(method, address)) return true;
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (
    method === "OPTIONS" &&
    url.origin === config.companionUrl &&
    url.pathname === "/preparation/fill" &&
    !url.search &&
    !url.username &&
    !url.password &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return config.allowPreparation === true;
  if (
    ["GET", "HEAD", "OPTIONS"].includes(method) ||
    ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname)
  )
    return questionsUiRequestAllowed(method, address, body, { ...config, questions: [] });
  if (
    method !== "POST" ||
    ![config.apiUrl, config.companionUrl].includes(url.origin) ||
    url.username ||
    url.password ||
    url.search ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return false;
  if (url.origin === config.apiUrl && url.pathname === "/api/auth/tokens/terminal")
    return config.allowPreparation === true && (!body || body === "null");
  let parsed;
  try {
    parsed = JSON.parse(body ?? "null");
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed).sort().join(",");
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (
    url.origin === config.apiUrl &&
    url.pathname === `/api/application-questions/${config.questionId}/document-selection`
  )
    return (
      keys ===
        "artifactRevision,confirmed,expectedCollectionVersion,expectedDefinitionHash,expectedRevision,expectedSelectionId,fieldKey,jobId,requestId,resumeId" &&
      uuid.test(parsed.requestId) &&
      parsed.jobId === config.jobId &&
      parsed.expectedCollectionVersion === config.collectionVersion &&
      parsed.expectedRevision === config.questionRevision &&
      parsed.expectedDefinitionHash === config.definitionHash &&
      parsed.fieldKey === config.fileFieldKey &&
      parsed.resumeId === config.resumeId &&
      parsed.artifactRevision === config.artifactRevision &&
      parsed.expectedSelectionId === null &&
      parsed.confirmed === true
    );
  if (url.origin === config.companionUrl && url.pathname === "/preparation/fill")
    return (
      config.allowPreparation === true &&
      keys === "apiToken,apiUrl,expectedCollectionVersion,jobId,manifestHash,requestId" &&
      typeof parsed.apiToken === "string" &&
      parsed.apiToken.length > 0 &&
      parsed.apiToken.length <= 10000 &&
      parsed.apiUrl === config.apiUrl &&
      parsed.jobId === config.jobId &&
      parsed.expectedCollectionVersion === config.collectionVersion &&
      parsed.manifestHash === config.manifestHash &&
      /^[a-f0-9]{64}$/.test(parsed.manifestHash) &&
      uuid.test(parsed.requestId)
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
    diagnostics = [];
  const expectedResourceErrors = new Set();
  const pdfViewerResources = new Set();
  const guard = { ...config, allowPreparation: false };
  let stage = "login",
    step = "open-login",
    selectionRequests = 0,
    tokenRequests = 0,
    preparationRequests = 0,
    diagnosticRequests = 0,
    diagnosticsTruncated = false;
  function resourceKey(address) {
    return preparationUiResourceKey(address);
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
    if (questionsUiDiagnosticAllowed(request.method(), request.url(), request.postData(), guard)) {
      diagnosticRequests++;
      await route.continue();
      return;
    }
    if (!preparationUiRequestAllowed(request.method(), request.url(), request.postData(), guard)) {
      if (
        request.method() === "GET" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["/queue/status"].includes(url.pathname) &&
        ![config.apiUrl, config.webUrl].includes(url.origin)
      )
        expectedResourceErrors.add(resourceKey(request.url()));
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
    if (preparationUiPdfResourceAllowed(request.method(), request.url()))
      pdfViewerResources.add(resourceKey(request.url()));
    if (request.method() === "POST") {
      if (url.pathname.endsWith("/document-selection")) selectionRequests++;
      if (url.pathname === "/api/auth/tokens/terminal") tokenRequests++;
      if (url.pathname === "/preparation/fill") preparationRequests++;
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
  try {
    await page.goto(`${config.webUrl}/login?next=/needs-you`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    step = "login-redirect";
    await page.waitForURL(`${config.webUrl}/needs-you`, { timeout: 60_000 });
    stage = "document-blocker";
    step = "initial-unanswered-count";
    await count(config.initialCount);
    step = "read-canonical-question";
    const canonical = await read(`/api/jobs/${config.jobId}/questions`);
    step = "validate-canonical-question";
    const question = preparationUiFixtureQuestion(canonical, config);
    guard.collectionVersion = canonical.collectionVersion;
    guard.questionRevision = question.revision;
    guard.definitionHash = question.definitionHash;
    const row = page.locator(`[data-application-question-id="${config.questionId}"]`);
    step = "unique-question-heading";
    await row.getByRole("heading", { name: question.definition.prompt, exact: true }).waitFor();
    step = "no-filename-answer-or-automatic-mutation";
    if (await row.getByRole("button", { name: "Save confirmed answer", exact: true }).count())
      throw new Error("A file-only question exposes a factual filename answer action");
    if (selectionRequests || preparationRequests || tokenRequests)
      throw new Error("Opening file question performed an automatic mutation");
    await record("file-question-remains-blocked-without-a-filename-answer");
    stage = "pdf-choice";
    step = "read-owned-resume";
    const resumes = await read("/api/resumes");
    const resume = resumes.find((item) => item.id === config.resumeId);
    if (!resume) throw new Error("Owned synthetic resume missing");
    step = "choose-owned-resume";
    await row.getByRole("combobox", { name: "Saved resume for this upload", exact: true }).click();
    await page.getByRole("option", { name: resume.label, exact: true }).click();
    step = "exact-pdf-identity-preview";
    await row.getByText(`PDF revision: ${config.artifactRevision}`, { exact: true }).waitFor();
    await row.getByText(`SHA-256: ${config.pdfSha256}`, { exact: false }).first().waitFor();
    await row.getByRole("link", { name: "Open exact PDF", exact: true }).waitFor();
    if (
      (await row
        .getByRole("button", { name: "Use this PDF for this upload", exact: true })
        .isEnabled()) ||
      selectionRequests
    )
      throw new Error("PDF preview implied upload consent");
    await record("owned-immutable-pdf-identity-requires-separate-consent");
    stage = "document-selection";
    step = "confirm-exact-pdf-selection";
    await row
      .getByRole("checkbox", { name: "I choose this exact PDF for this upload.", exact: true })
      .check();
    await row.getByRole("button", { name: "Use this PDF for this upload", exact: true }).click();
    step = "document-blocker-resolved";
    await count(0);
    step = "read-persisted-selection";
    const selected = await read(`/api/jobs/${config.jobId}/preparation?mode=preview`);
    const document = selected.documentFields.find(
      (field) => field.questionId === config.questionId && field.fieldKey === config.fileFieldKey,
    )?.selection;
    const selectedQuestion = selected.questions.find((item) => item.id === config.questionId);
    step = "validate-persisted-selection";
    if (
      !document?.available ||
      !document.current ||
      document.resumeId !== config.resumeId ||
      document.artifactRevision !== config.artifactRevision ||
      document.pdfSha256 !== config.pdfSha256 ||
      !document.confirmedAt ||
      selectedQuestion?.answer ||
      selectedQuestion?.blocking ||
      selected.submissionAllowed !== false
    )
      throw new Error("PDF selection did not persist separately from factual answers");
    const queueBefore = (await read(`/api/work-queue/${config.workItemId}`)).item;
    if (queueBefore.state !== "queued")
      throw new Error("Resolved document requirement did not safely release queued work");
    await record("document-selection-resolves-only-the-upload-requirement");
    stage = "preparation";
    step = "open-job-preparation";
    guard.manifestHash = selected.manifestHash;
    guard.allowPreparation = true;
    await page.goto(
      `${config.webUrl}/campaigns/${config.campaignId}?job=${encodeURIComponent(canonical.job.key)}`,
      { waitUntil: "domcontentloaded" },
    );
    const drawer = page.getByRole("dialog", { name: config.jobTitle, exact: true });
    step = "preparation-action-visible";
    await drawer.getByRole("button", { name: "Check form preparation", exact: true }).waitFor();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${config.companionUrl}/preparation/fill` &&
        response.request().method() === "POST",
      { timeout: 150_000 },
    );
    await drawer.getByRole("button", { name: "Check form preparation", exact: true }).click();
    step = "real-companion-response";
    const response = await responsePromise;
    if (!response.ok()) throw new Error("Real companion preparation failed");
    const prepared = await response.json();
    step = "validate-real-readback";
    if (
      prepared.jobId !== config.jobId ||
      prepared.collectionVersion !== selected.collectionVersion ||
      prepared.manifestHash !== selected.manifestHash ||
      prepared.status !== "filled" ||
      prepared.submissionAllowed !== false ||
      prepared.contextRetained !== false ||
      prepared.verification !== "observed"
    )
      throw new Error("Real preparation result did not preserve preview boundaries");
    const uploaded = prepared.fields.find(
      (field) => field.questionId === config.questionId && field.fieldKey === config.fileFieldKey,
    );
    if (uploaded?.status !== "verified" || uploaded.pdfSha256 !== config.pdfSha256)
      throw new Error("Readback did not verify the selected PDF bytes");
    const panel = drawer.locator(`[data-preparation-result-id="${prepared.resultId}"]`);
    step = "rendered-readback-and-preview-boundaries";
    await panel.getByText("This result does not authorize submission.", { exact: false }).waitFor();
    await panel.getByText("browser context closed", { exact: false }).waitFor();
    await panel.getByText(`PDF SHA-256: ${config.pdfSha256}`, { exact: true }).waitFor();
    for (const omitted of prepared.fields.filter((field) => field.status === "omitted")) {
      if ("value" in omitted || "pdfSha256" in omitted)
        throw new Error("Optional omission fabricated a factual value");
      const omittedQuestion = selected.questions.find((item) => item.id === omitted.questionId);
      const omittedDefinition = omittedQuestion?.definition.fields.find(
        (item) => item.key === omitted.fieldKey,
      );
      const label =
        omittedDefinition?.label || omittedQuestion?.definition.prompt || omitted.fieldKey;
      await panel.getByText(`${label}: Left blank`, { exact: true }).waitFor();
    }
    await record("real-code-only-preparation-shows-exact-pdf-readback");
    stage = "persisted";
    step = "refresh-unanswered-count";
    guard.allowPreparation = false;
    await page.goto(`${config.webUrl}/needs-you`, { waitUntil: "domcontentloaded" });
    await count(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await count(0);
    step = "validate-preserved-selection-and-queue";
    const after = await read(`/api/jobs/${config.jobId}/preparation?mode=preview`);
    const afterDocument = after.documentFields.find(
      (field) => field.questionId === config.questionId && field.fieldKey === config.fileFieldKey,
    )?.selection;
    if (
      JSON.stringify(afterDocument) !== JSON.stringify(document) ||
      (await read(`/api/work-queue/${config.workItemId}`)).item.state !== queueBefore.state ||
      after.submissionAllowed !== false
    )
      throw new Error("Preparation changed confirmed document identity or execution state");
    step = "final-runtime-and-request-audit";
    if (selectionRequests !== 1 || tokenRequests !== 1 || preparationRequests !== 1)
      throw new Error("Unexpected mutation count");
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
    await record("document-persists-with-no-submit-permission-or-agent-execution");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        preparationResponse: "real-companion",
        pdfViewerResources: [...pdfViewerResources].sort(),
        observations,
        blockedRequests,
        diagnostics,
        diagnosticRequests,
        diagnosticsTruncated,
        selectionRequests,
        tokenRequests,
        preparationRequests,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    if (new URL(page.url()).pathname !== "/login") {
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
        preparationResponse: "real-companion",
        pdfViewerResources: [...pdfViewerResources].sort(),
        failure: {
          stage,
          step,
          ...preparationUiFailure(error),
          errorClass: error?.name === "TimeoutError" ? "TimeoutError" : "Error",
          ...(screenshot ? { screenshot } : {}),
        },
        observations,
        blockedRequests,
        diagnostics,
        diagnosticRequests,
        diagnosticsTruncated,
        selectionRequests,
        tokenRequests,
        preparationRequests,
        screenshots,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observePreparationUi(environment, config) {
  assertLoopbackOrigins(
    [config.webUrl, config.apiUrl, config.companionUrl, config.cdpUrl],
    "Preparation UI regression requires loopback origins",
  );
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (
    ![config.jobId, config.campaignId, config.workItemId, config.questionId, config.resumeId].every(
      (id) => uuid.test(id),
    ) ||
    ![config.artifactRevision, config.pdfSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash)) ||
    config.initialCount !== 1 ||
    config.fileFieldKey !== "resume" ||
    config.fixtureUrl !== "http://127.0.0.1:14640/form"
  )
    throw new Error("Preparation UI regression requires the exact synthetic document fixture");
  const { outputDir, ...guestConfig } = config;
  const script = `const questionsUiRequestAllowed = ${questionsUiRequestAllowed.toString()}; const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; const preparationUiPdfResourceAllowed = ${preparationUiPdfResourceAllowed.toString()}; const preparationUiResourceKey = ${preparationUiResourceKey.toString()}; const preparationUiRequestAllowed = ${preparationUiRequestAllowed.toString()}; const preparationUiFixtureQuestion = ${preparationUiFixtureQuestion.toString()}; const preparationUiFailure = ${preparationUiFailure.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
