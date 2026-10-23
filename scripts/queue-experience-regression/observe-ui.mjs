import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { questionsUiDiagnosticAllowed } from "../questions-regression/observe-ui.mjs";
import { queueActivityPresented } from "./activity-visibility.mjs";
import { queueExperienceDiagnostic } from "./diagnostics.mjs";
import { queueExperienceRequestAllowed } from "./policy.mjs";

async function observeInGuest(config) {
  const { createHash } = await import("node:crypto");
  const { chromium } = await import(
    "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem("openapply:agent"))
      localStorage.setItem(
        "openapply:agent",
        JSON.stringify({ provider: "codex", advancedTools: false, dockExpanded: true }),
      );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const guard = { ...config, frameAllowed: false };
  const observations = [],
    screenshots = [],
    blockedRequests = [],
    diagnostics = [],
    controls = [];
  const frameRequests = [],
    expectedErrors = new Map();
  let stage = "login",
    queueMode = "loading",
    detailError = false,
    frameMode = "valid";
  let statusMode = "idle",
    releaseLoading,
    tokenRequests = 0,
    diagnosticRequests = 0;
  let requests = 0,
    diagnosticsOverflow = false,
    pilotErrors = 0,
    inboxErrors = 0;
  const loading = new Promise((resolve) => {
    releaseLoading = resolve;
  });
  const cors = {
    "access-control-allow-origin": config.webUrl,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  };
  const resource = (address) => {
    try {
      const u = new URL(address);
      return `${u.origin}${u.pathname}`;
    } catch {
      return "unknown";
    }
  };
  function expected(address, value) {
    const key = resource(address);
    const values = expectedErrors.get(key) ?? new Set();
    values.add(value);
    expectedErrors.set(key, values);
  }
  function fail(code) {
    throw Object.assign(new Error("Queue experience observation failed."), { code });
  }
  function diagnostic(kind, message, address) {
    if (diagnostics.length >= 60) {
      diagnosticsOverflow = true;
      return;
    }
    const known =
      message.startsWith("Failed to load resource:") &&
      [...(expectedErrors.get(resource(address)) ?? [])].some((v) => message.includes(v));
    diagnostics.push({
      kind,
      stage,
      code: known ? "expected-resource-error" : "unexpected",
      ...queueExperienceDiagnostic(message, address, guard),
      signature: createHash("sha256").update(message.slice(0, 4096)).digest("hex"),
    });
  }
  page.on("pageerror", (error) => diagnostic("pageerror", error.message, ""));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      diagnostic(message.type(), message.text(), message.location().url);
  });
  page.on("response", (response) => {
    if (
      stage === "login" &&
      response.status() === 401 &&
      new URL(response.url()).origin === config.apiUrl
    )
      expected(response.url(), "401");
  });
  let frameImages;
  await context.route("**/*", async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      method = request.method();
    if (++requests > 1200) {
      await route.abort("blockedbyclient");
      fail("request-limit");
    }
    if (questionsUiDiagnosticAllowed(method, request.url(), request.postData(), config)) {
      if (++diagnosticRequests > 100) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }
    if (!queueExperienceRequestAllowed(method, request.url(), request.postData(), guard)) {
      if (blockedRequests.length < 50)
        blockedRequests.push({ method, origin: u.origin, pathname: u.pathname.slice(0, 180) });
      await route.abort("blockedbyclient");
      return;
    }
    const json = (value, status = 200) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (u.origin === config.companionUrl) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      if (u.pathname === "/healthz") {
        expected(request.url(), "503");
        await json({ message: "Synthetic unavailable companion" }, 503);
        return;
      }
      if (u.pathname === "/queue/status") {
        await json({
          connectionId: statusMode === "idle" ? null : "00000000-0000-4000-8000-000000000088",
          ownerId:
            statusMode === "other-owner" ? "00000000-0000-4000-8000-000000000099" : config.userId,
          connected: statusMode !== "idle",
          running: statusMode === "workers",
          blockingReason: "Synthetic UI only; no model approval",
          lastError: null,
          configuredCapacity: 2,
          effectiveCapacity: 0,
          workers: statusMode === "idle" ? [] : config.workers,
          budget: { enabled: false, remainingAllocations: 0, reason: "No finite model approval" },
        });
        return;
      }
      const worker = config.workers.find(
        (w) => u.pathname === `/queue/workers/${w.browserSessionId}/frame`,
      );
      if (!worker || request.headers().authorization !== "Bearer synthetic-frame-only-token") {
        await json({ message: "Wrong synthetic frame owner" }, 403);
        return;
      }
      frameRequests.push({
        workItemId: worker.workItemId,
        browserSessionId: worker.browserSessionId,
        mode: frameMode,
      });
      if (frameMode === "error") {
        expected(request.url(), "503");
        await json({ message: "Synthetic frame interruption" }, 503);
        return;
      }
      await json({
        workItemId: worker.workItemId,
        executionId:
          frameMode === "wrong-identity"
            ? config.workers.find((w) => w !== worker).executionId
            : worker.executionId,
        browserSessionId: worker.browserSessionId,
        capturedAt: new Date().toISOString(),
        mimeType: "image/jpeg",
        imageBase64: frameImages[worker.slot - 1],
        width: 384,
        height: 216,
      });
      return;
    }
    if (u.origin === config.apiUrl && u.pathname === "/api/auth/tokens/terminal") {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      tokenRequests++;
      await json({ token: "synthetic-frame-only-token" });
      return;
    }
    if (u.origin === config.apiUrl && method === "GET") {
      if (u.pathname === "/api/work-queue" && queueMode !== "pass") {
        if (queueMode === "loading") await loading;
        expected(request.url(), "503");
        await json({ message: "Synthetic Queue read interruption" }, 503);
        return;
      }
      if (detailError && u.pathname === `/api/work-queue/${config.workers[0].workItemId}`) {
        expected(request.url(), "503");
        await json({ message: "Synthetic activity read interruption" }, 503);
        return;
      }
      if (
        stage === "frame-ui-fixture" &&
        config.workers.some((w) => u.pathname === `/api/work-queue/${w.workItemId}`)
      ) {
        const response = await route.fetch({ timeout: 15_000, maxRedirects: 0 });
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        const body = await response.json();
        // Only this separately labelled viewer simulation changes the rendered state, never the database.
        await json({
          ...body,
          item: {
            ...body.item,
            state: "filling",
            reason: "Simulated active UI response; no execution exists.",
          },
        });
        return;
      }
      if (stage === "pilot-error" && u.pathname === "/api/pilot") {
        pilotErrors++;
        expected(request.url(), "503");
        await json({ message: "Synthetic Pilot read interruption" }, 503);
        return;
      }
      if (stage === "inbox-error" && u.pathname === "/api/email/account") {
        inboxErrors++;
        expected(request.url(), "503");
        await json({ message: "Synthetic mailbox read interruption" }, 503);
        return;
      }
    }
    if (method === "POST" && u.pathname === `/api/work-queue/${config.controlId}/control`)
      controls.push(JSON.parse(request.postData()).action);
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const u = new URL(socket.url());
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    if (u.origin === config.webUrl) socket.connectToServer();
    else {
      blockedRequests.push({ method: "WEBSOCKET", origin: u.origin, pathname: u.pathname });
      socket.close();
    }
  });
  async function read(path) {
    const result = await page.evaluate(async (address) => {
      const response = await fetch(address, {
        credentials: "include",
        signal: AbortSignal.timeout(15_000),
      });
      return { ok: response.ok, body: response.ok ? await response.json() : null };
    }, `${config.apiUrl}${path}`);
    if (!result.ok) fail("canonical-read-failed");
    return result.body;
  }
  async function record(name) {
    if (screenshots.length >= 25) fail("screenshot-limit");
    observations.push({ name, passed: true, viewport: page.viewportSize() });
    screenshots.push({
      name,
      screenshot: (
        await page.screenshot({
          fullPage: false,
          mask: [page.locator("input"), page.locator("textarea")],
        })
      ).toString("base64"),
    });
  }
  async function fit() {
    const fits = await page.evaluate(() => {
      const main = document.querySelector("main");
      return (
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        main &&
        main.scrollWidth <= main.clientWidth + 1
      );
    });
    if (!fits) fail("laptop-horizontal-overflow");
  }
  async function navigation() {
    const rail = page.getByRole("complementary", { name: "OpenApply", exact: true });
    await rail.locator('a[href="/queue"]').waitFor();
    await rail.locator('a[href="/needs-you"]').waitFor();
    const summary = await read("/api/work-queue/summary"),
      count = await read("/api/needs-you/count");
    await rail.locator(`[title="${summary.queued + summary.running} queued or running"]`).waitFor();
    await rail.locator(`[title="${count.total} items need you"]`).waitFor();
    if (
      count.total !== config.needsYouTotal ||
      summary.needsUser !== config.blockedWorkCount ||
      count.total === summary.needsUser
    )
      fail("attention-counts-conflated");
  }
  const aside = () => page.getByRole("complementary", { name: "Queue activity", exact: true });
  const listRow = (id) =>
    page
      .locator(`[data-work-item-id="${id}"]`)
      .filter({ has: page.getByRole("button", { name: "View activity", exact: true }) });
  async function openActivity(id) {
    await listRow(id).getByRole("button", { name: "View activity", exact: true }).click();
    await aside().waitFor();
    if (await page.getByRole("dialog").count()) fail("activity-is-modal");
    await page.waitForFunction(
      () => document.activeElement === document.querySelector('aside[aria-label="Queue activity"]'),
      null,
      { timeout: 5_000 },
    );
    const title = await aside().getByText("Queue activity", { exact: true }).boundingBox(),
      close = await aside()
        .getByRole("button", { name: "Close activity", exact: true })
        .boundingBox();
    const rect = (box) =>
      box && { top: box.y, left: box.x, bottom: box.y + box.height, right: box.x + box.width };
    const main = await page.locator("main").boundingBox();
    const focused = await aside().evaluate((panel) => panel === document.activeElement);
    if (
      !queueActivityPresented({
        viewport: page.viewportSize(),
        main: rect(main),
        title: rect(title),
        close: rect(close),
        focused,
      })
    )
      fail("activity-opened-outside-viewport");
  }
  async function closeActivity(id) {
    await aside().getByRole("button", { name: "Close activity", exact: true }).click();
    await aside().waitFor({ state: "detached" });
    const restored = await listRow(id)
      .getByRole("button", { name: "View activity", exact: true })
      .evaluate((button) => document.activeElement === button);
    if (!restored) fail("activity-close-lost-trigger-focus");
  }
  try {
    await page.goto(`${config.webUrl}/login?next=/queue`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/queue`);
    stage = "queue-loading";
    await page.getByRole("progressbar", { name: "Loading queue items" }).waitFor();
    await record("1366-queue-loading-before-read-completes");
    queueMode = "error";
    releaseLoading();
    const error = page.getByRole("alert").filter({
      hasText: "Could not load your queue. Its current state is unknown; reload before acting.",
    });
    await error.waitFor();
    if (await page.locator("[data-work-item-id]").count()) fail("stale-queue-actions-visible");
    await record("1366-queue-read-error-hides-actions");
    queueMode = "pass";
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await listRow(config.controlId).waitFor();
    await navigation();
    await fit();
    await page
      .getByText(`${config.blockedWorkCount} blocked work items`, { exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: `Needs you · ${config.needsYouTotal}`, exact: true })
      .waitFor();
    await record("1366-queue-nav-and-canonical-attention-counts");
    stage = "activity-controls";
    await openActivity(config.controlId);
    await aside()
      .getByText(`Synthetic recorded activity for ${config.controlTitle}. No model execution.`, {
        exact: true,
      })
      .waitFor();
    await fit();
    await record("1366-inline-activity-keeps-queue-accessible");
    await openActivity(config.controlId);
    await record("same-item-activity-reopen-restores-visible-focus");
    await closeActivity(config.controlId);
    for (const [action, label] of [
      ["Pause", "Paused"],
      ["Resume", "Queued"],
      ["Stop", "Stopped"],
    ]) {
      await listRow(config.controlId).getByRole("button", { name: action, exact: true }).click();
      await listRow(config.controlId).getByText(label, { exact: true }).waitFor();
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await listRow(config.controlId).getByText("Stopped", { exact: true }).waitFor();
    if (
      await listRow(config.controlId)
        .getByRole("button", { name: /^(Pause|Resume|Stop)$/ })
        .count()
    )
      fail("terminal-work-exposes-replay");
    if (
      JSON.stringify(controls) !== JSON.stringify(["pause", "resume", "stop"]) ||
      (await read(`/api/work-queue/${config.controlId}`)).item.state !== "cancelled"
    )
      fail("wrong-control-sequence");
    await record("explicit-controls-affect-only-target-and-stop-persists");
    stage = "needs-you";
    await page
      .getByRole("link", { name: `Needs you · ${config.needsYouTotal}`, exact: true })
      .click();
    await page.locator(`[data-needs-you-total="${config.needsYouTotal}"]`).waitFor();
    const attention = await read("/api/needs-you?page=1&limit=25&kind=all");
    if (
      attention.pagination.total !== config.needsYouTotal ||
      attention.items.length !== config.needsYouTotal
    )
      fail("canonical-attention-mismatch");
    await navigation();
    await fit();
    await record("single-needs-you-list-matches-navigation-total");
    stage = "submitted";
    await page.goto(`${config.webUrl}/queue?state=submitted`, { waitUntil: "domcontentloaded" });
    const submitted = listRow(config.submittedId);
    await submitted.getByText("Submitted", { exact: true }).waitFor();
    if (await submitted.getByRole("button", { name: /^(Pause|Resume|Stop)$/ }).count())
      fail("submitted-work-exposes-replay");
    await submitted.getByRole("link", { name: "Application record", exact: true }).click();
    await page.getByText(config.receiptReference, { exact: true }).waitFor();
    const pdfUrl = `${config.apiUrl}/api/applied/${config.applicationId}/submitted-resume?sha256=${config.pdfSha256}`;
    if ((await page.getByRole("link", { name: /^Submitted PDF:/ }).getAttribute("href")) !== pdfUrl)
      fail("wrong-submitted-pdf-link");
    const pdf = await page.evaluate(async (address) => {
      const response = await fetch(address, {
        credentials: "include",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf"))
        return null;
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 5_242_880) {
          await reader.cancel();
          return null;
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return null;
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    }, pdfUrl);
    if (pdf !== config.pdfSha256) fail("submitted-pdf-bytes-mismatch");
    await record("synthetic-submitted-record-retains-exact-pdf-bytes");
    stage = "frame-ui-fixture";
    guard.frameAllowed = true;
    statusMode = "workers";
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${config.webUrl}/queue`, { waitUntil: "domcontentloaded" });
    frameImages = await page.evaluate(() =>
      ["A", "B"].map((name) => {
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 216;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = name === "A" ? "#d6e4ff" : "#d7f2dd";
        ctx.fillRect(0, 0, 384, 216);
        ctx.fillStyle = "#152238";
        ctx.font = "20px sans-serif";
        ctx.fillText(`Synthetic worker ${name}`, 30, 80);
        ctx.fillText("UI frame response only", 30, 120);
        return canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
      }),
    );
    await navigation();
    await openActivity(config.workers[0].workItemId);
    await aside().getByRole("button", { name: "View browser", exact: true }).click();
    await aside().getByRole("img", { name: "Worker 1 browser, read-only", exact: true }).waitFor();
    await fit();
    await record("1440-simulated-read-only-frame-binds-worker-one");
    frameMode = "wrong-identity";
    await aside()
      .getByText(
        "Live view unavailable. Check Queue activity for the application's recorded state.",
        { exact: true },
      )
      .waitFor();
    if (await aside().getByRole("img").count()) fail("mismatched-frame-remains-visible");
    await record("simulated-wrong-execution-frame-is-hidden");
    frameMode = "valid";
    await aside().getByRole("img", { name: "Worker 1 browser, read-only", exact: true }).waitFor();
    detailError = true;
    await aside()
      .getByText("Could not load this activity. Its current state is unknown.", { exact: true })
      .waitFor();
    if (
      (await aside().getByRole("img").count()) ||
      (await aside().locator("[data-work-item-id]").count())
    )
      fail("stale-activity-retained");
    await record("stale-activity-error-hides-controls-and-browser");
    detailError = false;
    await aside().getByRole("button", { name: "Retry activity", exact: true }).click();
    await aside().locator(`[data-work-item-id="${config.workers[0].workItemId}"]`).waitFor();
    await openActivity(config.workers[1].workItemId);
    if (
      await aside().getByRole("img", { name: "Worker 1 browser, read-only", exact: true }).count()
    )
      fail("previous-worker-leaked");
    await aside().getByRole("button", { name: "View browser", exact: true }).click();
    await aside().getByRole("img", { name: "Worker 2 browser, read-only", exact: true }).waitFor();
    await fit();
    await record("1440-worker-switch-clears-previous-frame");
    await closeActivity(config.workers[1].workItemId);
    const framesAtClose = frameRequests.length;
    await page.waitForTimeout(2500);
    if (frameRequests.length !== framesAtClose) fail("closed-frame-keeps-polling");
    statusMode = "other-owner";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openActivity(config.workers[0].workItemId);
    await aside()
      .getByText("No active browser is available for this work item.", { exact: true })
      .waitFor();
    if (await aside().getByRole("button", { name: "View browser", exact: true }).count())
      fail("other-account-worker-visible");
    await record("other-account-companion-response-cannot-open-frame");
    stage = "pilot-error";
    // Pilot is behind the local preference gate; this enables no run or approval.
    await page.evaluate(() =>
      localStorage.setItem(
        "openapply:agent",
        JSON.stringify({ provider: "codex", advancedTools: true, dockExpanded: true }),
      ),
    );
    await page.goto(`${config.webUrl}/pilot`, { waitUntil: "domcontentloaded" });
    await page.getByText("Could not load Pilot. Try again.", { exact: true }).waitFor();
    await record("pilot-read-error-ends-loading");
    stage = "inbox-error";
    await page.goto(`${config.webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByText("Could not load your mailbox connection.", { exact: true }).waitFor();
    if (await page.getByText("No mailbox connected", { exact: true }).count())
      fail("inbox-error-claimed-disconnected");
    await record("mailbox-error-is-distinct-from-unconnected");
    stage = "advanced-dock";
    statusMode = "idle";
    await page.goto(`${config.webUrl}/queue`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open agent dock", exact: true }).waitFor();
    if (
      (await page.getByRole("heading", { name: "Advanced terminal", exact: true }).count()) ||
      (await page.getByRole("dialog").count())
    )
      fail("dock-auto-expanded");
    await page.getByRole("button", { name: "Open agent dock", exact: true }).click();
    await page.getByRole("heading", { name: "Advanced terminal", exact: true }).waitFor();
    if (await page.getByRole("dialog").count()) fail("dock-is-modal");
    await page.getByRole("button", { name: "Collapse terminal", exact: true }).click();
    await fit();
    await record("advanced-terminal-starts-collapsed-and-expands-inline");
    stage = "audit";
    if (
      blockedRequests.length ||
      diagnosticsOverflow ||
      diagnosticRequests > 100 ||
      diagnostics.some(
        (d) => d.kind === "pageerror" || (d.kind === "error" && d.code === "unexpected"),
      )
    )
      fail("unexpected-browser-request-or-error");
    if (tokenRequests !== 2 || !pilotErrors || !inboxErrors || frameRequests.length < 4)
      fail("missing-observation");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        providerProcesses: 0,
        employerSubmissions: 0,
        frameEvidence:
          "Synthetic browser status, active-detail state, token and JPEG responses only. Actual terminal/broker ownership and capture are separate tests.",
        controls,
        tokenRequests,
        frameRequests,
        observations,
        blockedRequests,
        diagnostics,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    try {
      if (new URL(page.url()).pathname !== "/login")
        screenshot = (
          await page.screenshot({
            fullPage: false,
            mask: [page.locator("input"), page.locator("textarea")],
          })
        ).toString("base64");
    } catch {}
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        modelCalls: 0,
        failure: {
          stage,
          code:
            typeof error?.code === "string" && /^[a-z-]{1,80}$/.test(error.code)
              ? error.code
              : "ui-observation-incomplete",
          ...(screenshot ? { screenshot } : {}),
        },
        controls,
        tokenRequests,
        frameRequests,
        observations,
        blockedRequests,
        diagnostics,
        screenshots,
      }),
    );
  } finally {
    releaseLoading();
    await context.close();
    await browser.close();
  }
}

export async function observeQueueExperienceUi(environment, config) {
  for (const value of [config.webUrl, config.apiUrl, config.cdpUrl, config.companionUrl]) {
    const u = new URL(value);
    assert.ok(
      ["http:", "https:"].includes(u.protocol) &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === "/",
    );
  }
  assert.notEqual(config.apiUrl, config.companionUrl);
  assert.equal(config.provider, "codex");
  assert.equal(config.workers.length, 2);
  const directory = resolve(config.outputDir);
  await mkdir(directory, { recursive: true });
  const { outputDir: _outputDir, ...guestConfig } = config;
  const program = `const queueExperienceRequestAllowed = ${queueExperienceRequestAllowed.toString()}; const queueExperienceDiagnostic = ${queueExperienceDiagnostic.toString()}; const queueActivityPresented = ${queueActivityPresented.toString()}; const questionsUiDiagnosticAllowed = ${questionsUiDiagnosticAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  const result = JSON.parse(
    await environment.guestCommand(["node", "--input-type=module"], {
      input: program,
      timeout: 300_000,
    }),
  );
  assert.ok(Array.isArray(result.screenshots) && result.screenshots.length <= 25);
  for (const entry of result.screenshots) {
    assert.match(entry.name, /^[a-z0-9-]{1,100}$/);
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
