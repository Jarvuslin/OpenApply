import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertLoopbackOrigins,
  questionsUiDiagnosticAllowed,
} from "../questions-regression/observe-ui.mjs";

export function telegramUiRequestAllowed(method, address, body, config) {
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
  const mutationPath = [
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/telegram",
    "/api/telegram/settings",
    "/api/telegram/pairing",
    ...(config.pairingId ? [`/api/telegram/pairing/${config.pairingId}`] : []),
    `/api/pilot/questions/${config.approvalQuestionId}/decision`,
  ].includes(url.pathname);
  if (method === "OPTIONS") return mutationPath && !url.search;
  if (["GET", "HEAD"].includes(method)) {
    if (
      [
        "/api/auth/me",
        "/api/auth/options",
        "/api/telegram",
        "/api/needs-you/count",
        "/api/needs-you/events",
        "/api/workspace/events",
        "/api/work-queue/events",
        "/api/work-queue/summary",
        `/api/job-intakes/${config.intakeId}`,
        `/api/pilot/questions/${config.approvalQuestionId}/approval`,
        `/api/campaigns/${config.approvalCampaignId}/jobs/${encodeURIComponent(config.approvalJobKey)}/submission-attempt`,
        `/api/campaigns/${config.approvalCampaignId}/jobs/${encodeURIComponent(config.approvalJobKey)}/submission-checkpoints/${config.approvalCheckpointId}/pdf`,
      ].includes(url.pathname)
    )
      return !url.search;
    if (url.pathname === "/api/needs-you")
      return [...url.searchParams].every(
        ([key, value]) =>
          (["page", "limit"].includes(key) && /^[1-9]\d{0,3}$/.test(value)) ||
          (key === "kind" && ["all", "operational"].includes(value)) ||
          (key === "target" && value === config.approvalQuestionId),
      );
    return false;
  }
  if (!mutationPath || url.search) return false;
  if (method === "DELETE" && url.pathname === `/api/telegram/pairing/${config.pairingId}`)
    return body == null || body === "" || body === "null";
  if (method === "POST" && ["/api/auth/refresh", "/api/auth/logout"].includes(url.pathname))
    return body == null || body === "" || body === "null";
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed).sort().join(",");
  const uuid = (value) =>
    typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
  if (method === "POST" && url.pathname === "/api/auth/login")
    return (
      keys === "email,password" &&
      parsed.email === config.loginEmail &&
      parsed.password === config.password
    );
  if (method === "DELETE" && url.pathname === "/api/telegram")
    return keys === "expectedLinkId" && parsed.expectedLinkId === config.linkId;
  if (method === "POST" && url.pathname === "/api/telegram/pairing")
    return keys === "requestId" && uuid(parsed.requestId);
  if (method === "PATCH" && url.pathname === "/api/telegram/settings") {
    return (
      keys === "digestEnabled,digestHour,expectedRevision,quietHours,requestId,timeZone" &&
      uuid(parsed.requestId) &&
      parsed.expectedRevision === config.settingsRevision &&
      JSON.stringify([
        parsed.digestEnabled,
        parsed.digestHour,
        parsed.timeZone,
        parsed.quietHours,
      ]) ===
        JSON.stringify([
          config.targetSettings.digestEnabled,
          config.targetSettings.digestHour,
          config.targetSettings.timeZone,
          config.targetSettings.quietHours,
        ])
    );
  }
  if (
    method === "POST" &&
    url.pathname === `/api/pilot/questions/${config.approvalQuestionId}/decision`
  )
    return (
      keys === "checkpointHash,checkpointId,decision,requestId" &&
      uuid(parsed.requestId) &&
      parsed.checkpointId === config.approvalCheckpointId &&
      parsed.checkpointHash === config.approvalCheckpointHash &&
      parsed.decision === "approve"
    );
  return false;
}

async function observeInGuest(config) {
  const modulePath = "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs";
  const { chromium } = await import(modulePath);
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const guard = { ...config, pairingId: undefined, settingsRevision: undefined };
  const observations = [],
    screenshots = [],
    blockedRequests = [],
    diagnostics = [],
    settingsRequests = [],
    approvalRequests = [];
  const expectedResources = new Map();
  let stage = "login",
    step = "open-login",
    authRequests = 0,
    pairingRequests = 0,
    cancelRequests = 0,
    unlinkRequests = 0,
    diagnosticRequests = 0;
  let injectReadError = true;
  function resource(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "unknown";
    }
  }
  function expectResource(value, status) {
    const key = resource(value),
      values = expectedResources.get(key) ?? new Set();
    values.add(status);
    expectedResources.set(key, values);
  }
  function diagnostic(kind, message, address) {
    if (diagnostics.length >= 60) return;
    // Retain categories only: raw browser diagnostics may include a pairing response.
    const text = String(message);
    let code = "unexpected";
    if (kind === "warning") code = "warning";
    if (text.startsWith("Failed to load resource:"))
      code =
        [...(expectedResources.get(resource(address)) ?? [])].find((value) =>
          text.includes(value),
        ) ?? "unexpected";
    diagnostics.push({ kind, stage, code, resource: resource(address) });
  }
  const offline = (entry) =>
    entry.method === "GET" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(entry.hostname) &&
    ["/queue/status"].includes(entry.pathname) &&
    ![config.apiUrl, config.webUrl].includes(entry.origin);
  page.on("pageerror", (error) => diagnostic("pageerror", error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      diagnostic(message.type(), message.text(), message.location().url);
  });
  page.on("response", (response) => {
    if (
      stage === "login" &&
      response.status() === 401 &&
      new URL(response.url()).pathname.startsWith("/api/auth/")
    )
      expectResource(response.url(), "401");
  });
  const cors = {
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
    if (!telegramUiRequestAllowed(request.method(), request.url(), request.postData(), guard)) {
      const entry = {
        method: request.method(),
        origin: url.origin,
        hostname: url.hostname,
        pathname: url.pathname,
      };
      if (offline(entry)) expectResource(request.url(), "ERR_BLOCKED_BY_CLIENT");
      blockedRequests.push(entry);
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "POST" && url.pathname.startsWith("/api/auth/")) authRequests++;
    if (injectReadError && request.method() === "GET" && url.pathname === "/api/telegram") {
      injectReadError = false;
      expectResource(request.url(), "503");
      await route.fulfill({
        status: 503,
        headers: cors,
        contentType: "application/json",
        body: '{"message":"Synthetic status interruption"}',
      });
      return;
    }
    if (request.method() === "DELETE" && url.pathname === "/api/telegram") unlinkRequests++;
    if (request.method() === "DELETE" && url.pathname.startsWith("/api/telegram/pairing/"))
      cancelRequests++;
    if (request.method() === "POST" && url.pathname === "/api/telegram/pairing") pairingRequests++;
    if (request.method() === "PATCH") {
      const body = JSON.parse(request.postData());
      settingsRequests.push({ requestId: body.requestId, expectedRevision: body.expectedRevision });
      if (settingsRequests.length === 1) {
        expectResource(request.url(), "409");
        await route.fulfill({
          status: 409,
          headers: cors,
          contentType: "application/json",
          body: '{"message":"Synthetic stale settings"}',
        });
        return;
      }
      if (settingsRequests.length === 2) {
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        // Commit once, then withhold the acknowledgement until the UI's bounded deadline.
        expectResource(request.url(), "ERR_ABORTED");
        expectResource(request.url(), "ERR_FAILED");
        await new Promise((resolve) => setTimeout(resolve, 16_000));
        try {
          await route.abort("failed");
        } catch {
          /* Client already cancelled on deadline. */
        }
        return;
      }
    }
    if (request.method() === "POST" && url.pathname.endsWith("/decision")) {
      const body = JSON.parse(request.postData());
      approvalRequests.push({ requestId: body.requestId });
      if (approvalRequests.length === 1) {
        expectResource(request.url(), "409");
        await route.fulfill({
          status: 409,
          headers: cors,
          contentType: "application/json",
          body: '{"message":"Synthetic stale approval"}',
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
  function fail(code) {
    throw Object.assign(new Error("Model-free Telegram observation failed."), { code });
  }
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
          mask: [
            page.locator("input"),
            page.locator("textarea"),
            page.locator("[data-private-pairing]"),
          ],
        })
      ).toString("base64"),
    });
  }
  async function fillSettings() {
    const toggle = page.getByRole("switch", { name: "Daily digest", exact: true });
    if ((await toggle.isChecked()) !== config.targetSettings.digestEnabled) await toggle.click();
    await page
      .getByLabel("Digest hour (0–23)", { exact: true })
      .fill(String(config.targetSettings.digestHour));
    await page.getByLabel("Time zone", { exact: true }).fill(config.targetSettings.timeZone);
    const quiet = page.getByRole("switch", { name: "Quiet hours", exact: true });
    if (await quiet.isChecked()) await quiet.click();
  }
  try {
    await page.goto(`${config.webUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    stage = "settings";
    step = "status-read-recovery";
    await page.goto(`${config.webUrl}/settings/telegram`, { waitUntil: "domcontentloaded" });
    await page.getByText("Couldn't load your Telegram connection.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Connected", { exact: true }).waitFor();
    const initial = await read("/api/telegram");
    if (initial.link?.id !== config.linkId || !initial.configured || initial.deliveryEnabled)
      fail("invalid-ui-fixture");
    guard.settingsRevision = initial.settings.revision;
    await record("linked-status-and-disabled-delivery-recover-from-read-error");
    step = "settings-cas";
    await fillSettings();
    await page.getByRole("button", { name: "Save Telegram notifications", exact: true }).click();
    await page
      .getByText(
        "Saved settings changed. Reload them before editing again; this replaces your draft.",
        { exact: true },
      )
      .waitFor();
    await record("stale-notification-settings-require-explicit-reload");
    await page.getByRole("button", { name: "Reload saved notifications", exact: true }).click();
    await page
      .getByRole("button", { name: "Save Telegram notifications", exact: true })
      .waitFor({ state: "visible" });
    await fillSettings();
    await page.getByRole("button", { name: "Save Telegram notifications", exact: true }).click();
    await page
      .getByText(
        "The save was not acknowledged. Retry the same save or reload saved settings to inspect the result.",
        { exact: true },
      )
      .waitFor();
    if (settingsRequests.length !== 2) fail("automatic-save-retry");
    await record("lost-notification-acknowledgement-retains-exact-save");
    await page.getByRole("button", { name: "Retry same notification save", exact: true }).click();
    await page
      .locator(`[data-telegram-settings-revision="${guard.settingsRevision + 1}"]`)
      .waitFor();
    if (
      settingsRequests.length !== 3 ||
      settingsRequests[1].requestId !== settingsRequests[2].requestId
    )
      fail("changed-save-identity");
    const saved = await read("/api/telegram");
    if (
      saved.settings.revision !== guard.settingsRevision + 1 ||
      JSON.stringify([
        saved.settings.digestEnabled,
        saved.settings.digestHour,
        saved.settings.timeZone,
        saved.settings.quietHours,
      ]) !==
        JSON.stringify([
          config.targetSettings.digestEnabled,
          config.targetSettings.digestHour,
          config.targetSettings.timeZone,
          config.targetSettings.quietHours,
        ])
    )
      fail("settings-not-persisted");
    await record("manual-retry-commits-one-notification-revision");
    step = "unlink-pairing";
    await page.getByRole("button", { name: "Unlink", exact: true }).click();
    await page.getByText("Telegram is disconnected.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Connect Telegram", exact: true }).click();
    await page.locator("[data-private-pairing]").waitFor();
    const pending = await read("/api/telegram");
    guard.pairingId = pending.pairing?.id;
    if (!guard.pairingId || pending.link) fail("pairing-not-pending");
    await record("unlink-then-one-time-pairing-code-and-qr");
    await page.getByRole("button", { name: "Get a new code", exact: true }).click();
    await page.waitForFunction(
      async ({ url, previous }) => {
        const response = await fetch(url, { credentials: "include" });
        const body = response.ok ? await response.json() : null;
        return !!body?.pairing && body.pairing.id !== previous;
      },
      { url: `${config.apiUrl}/api/telegram`, previous: guard.pairingId },
    );
    guard.pairingId = (await read("/api/telegram")).pairing?.id;
    await record("new-code-replaces-the-previous-one");
    stage = "intake";
    step = "pending-job";
    await page.goto(`${config.webUrl}/job-intakes/${config.intakeId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(`[data-job-intake-id="${config.intakeId}"]`).waitFor();
    await page.getByText("Fit: Pending assessment", { exact: true }).waitFor();
    if (
      !(await page.getByRole("button", { name: "Apply now", exact: true }).isDisabled()) ||
      !(await page.getByRole("button", { name: "Prepare this job", exact: true }).isDisabled())
    )
      fail("unready-intake-enabled");
    await record("unready-intake-does-not-choose-provider-or-start-work");
    stage = "approval";
    step = "canonical-approval";
    await page.goto(
      `${config.webUrl}/needs-you?kind=operational&target=${config.approvalQuestionId}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    const card = page.locator(`[data-checkpoint-approval-id="${config.approvalQuestionId}"]`);
    await card.waitFor();
    await card.getByText("Saved preparation", { exact: true }).waitFor();
    const expectedPdf = `${config.apiUrl}/api/campaigns/${config.approvalCampaignId}/jobs/${encodeURIComponent(config.approvalJobKey)}/submission-checkpoints/${config.approvalCheckpointId}/pdf`;
    if (
      (await card.getByRole("link", { name: /^Retained PDF:/ }).getAttribute("href")) !==
      expectedPdf
    )
      fail("incorrect-checkpoint-pdf-link");
    const retained = await read(
      `/api/campaigns/${config.approvalCampaignId}/jobs/${encodeURIComponent(config.approvalJobKey)}/submission-attempt`,
    );
    const pdf = await page.evaluate(async (address) => {
      const response = await fetch(address, {
        credentials: "include",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf"))
        return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 10_000_000) {
          await reader.cancel();
          return null;
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return null;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return {
        size,
        sha256: [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
      };
    }, expectedPdf);
    if (
      !pdf?.size ||
      retained.attempt?.checkpointId !== config.approvalCheckpointId ||
      pdf.sha256 !== retained.attempt?.checkpoint?.resume.sha256
    )
      fail("retained-pdf-unavailable-or-mismatched");
    await card.getByRole("button", { name: /^Reviewed form answers/ }).click();
    if (
      !(await card
        .getByRole("button", { name: "Approve reviewed application", exact: true })
        .isDisabled())
    )
      fail("unreviewed-approval-enabled");
    await card.getByRole("checkbox").check();
    await card.getByRole("button", { name: "Approve reviewed application", exact: true }).click();
    await card
      .getByText(
        "This approval changed or expired. Reload the request and review the current application.",
        { exact: true },
      )
      .waitFor();
    await record("stale-checkpoint-decision-locks-approval-until-explicit-review");
    await card.getByRole("button", { name: "Reload approval request", exact: true }).click();
    await card.getByRole("checkbox").check();
    await card.getByRole("button", { name: "Approve reviewed application", exact: true }).click();
    await card.waitFor({ state: "detached" });
    const resolved = await read(`/api/pilot/questions/${config.approvalQuestionId}/approval`);
    if (resolved.approval?.decision !== "approve" || resolved.approval?.consumedAt !== null)
      fail("approval-not-canonical");
    await record("human-approval-resolves-canonical-needs-you-without-submission");
    stage = "audit";
    step = "network-and-console";
    if (blockedRequests.some((entry) => !offline(entry))) fail("unexpected-request");
    if (
      diagnostics.length >= 60 ||
      diagnostics.some(
        (entry) =>
          entry.kind === "pageerror" || (entry.kind === "error" && entry.code === "unexpected"),
      )
    )
      fail("unexpected-browser-error");
    if (
      // Connect, then Get a new code; the new code replaces the old one without a cancel call.
      pairingRequests !== 2 ||
      cancelRequests !== 0 ||
      unlinkRequests !== 1 ||
      approvalRequests.length !== 2
    )
      fail("unexpected-mutation-count");
    await record("channel-verification-performs-no-claim-model-or-external-message");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        externalTelegramRequests: 0,
        authRequests,
        pairingRequests,
        cancelRequests,
        unlinkRequests,
        settingsRequests,
        approvalRequests,
        diagnosticRequests,
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
            mask: [
              page.locator("input"),
              page.locator("textarea"),
              page.locator("[data-private-pairing]"),
            ],
          })
        ).toString("base64");
      } catch {}
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        modelCalls: 0,
        externalTelegramRequests: 0,
        failure: {
          stage,
          step,
          code: error?.code ?? (error?.name === "TimeoutError" ? "ui-timeout" : "observer-error"),
          ...(screenshot ? { screenshot } : {}),
        },
        authRequests,
        pairingRequests,
        cancelRequests,
        unlinkRequests,
        settingsRequests,
        approvalRequests,
        diagnosticRequests,
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

export async function observeTelegramUi(environment, config) {
  assertLoopbackOrigins(
    [config.webUrl, config.apiUrl, config.cdpUrl],
    "Telegram UI regression requires loopback origins.",
  );
  for (const field of [
    "userId",
    "linkId",
    "intakeId",
    "approvalQuestionId",
    "approvalCheckpointId",
    "approvalJobId",
    "approvalCampaignId",
  ])
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(config[field]))
      throw new Error("Telegram UI regression requires exact synthetic record identities.");
  if (
    !/^[a-f0-9]{64}$/.test(config.approvalCheckpointHash) ||
    config.targetSettings?.quietHours !== null
  )
    throw new Error(
      "Telegram UI regression requires bounded synthetic approval/settings evidence.",
    );
  if (
    typeof config.approvalJobKey !== "string" ||
    !config.approvalJobKey ||
    config.approvalJobKey.length > 200
  )
    throw new Error("Missing bounded synthetic job key.");
  const directory = resolve(config.outputDir);
  await mkdir(directory, { recursive: true });
  const { outputDir: _outputDir, ...guestConfig } = config;
  const script = `const questionsUiDiagnosticAllowed=${questionsUiDiagnosticAllowed.toString()};const telegramUiRequestAllowed=${telegramUiRequestAllowed.toString()};await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
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
    const filename = join(directory, "failed-ui.png");
    await writeFile(filename, Buffer.from(result.failure.screenshot, "base64"));
    result.failure.screenshot = filename;
  }
  await writeFile(join(directory, "ui-observations.json"), JSON.stringify(result, null, 2));
  return result;
}
