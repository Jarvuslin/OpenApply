import { runGuestObserver } from "../questions-regression/observe-ui.mjs";

export function queueUiRequestAllowed(method, address, body, config) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  const origins = [config.webUrl, config.apiUrl];
  if (!origins.includes(url.origin) || url.username || url.password) return false;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  if (
    /\/(inference|sessions|pilot\/(start|tick)|work-queue\/(claim|schedule))\b/.test(url.pathname)
  )
    return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (method !== "POST" || url.origin !== config.apiUrl) return false;
  if (["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname))
    return true;
  if (url.pathname !== `/api/work-queue/${config.workItemId}/control`) return false;
  try {
    const parsed = JSON.parse(body ?? "null");
    return (
      parsed &&
      Object.keys(parsed).length === 1 &&
      ["pause", "resume", "stop"].includes(parsed.action)
    );
  } catch {
    return false;
  }
}

async function observeInGuest(config) {
  const { chromium } = await import(
    "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const blockedRequests = [];
  const controls = [];
  const observations = [];
  const screenshots = [];
  let injectListError = true;
  let stage = "login";
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!queueUiRequestAllowed(request.method(), request.url(), request.postData(), config)) {
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
      /^\/api\/work-queue\/?$/.test(url.pathname)
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic queue read failure" }),
        headers: {
          "access-control-allow-origin": config.webUrl,
          "access-control-allow-credentials": "true",
        },
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/api/work-queue/${config.workItemId}/control`
    )
      controls.push(JSON.parse(request.postData()).action);
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
  try {
    await page.goto(`${config.webUrl}/login?next=/queue`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${config.webUrl}/queue`, { timeout: 60_000 });
    stage = "queue-error";
    await page.getByRole("heading", { name: "Queue", exact: true }).waitFor();
    const loadError = page.getByRole("alert").filter({
      hasText: "Could not load your queue. Its current state is unknown; reload before acting.",
    });
    await loadError.waitFor({ timeout: 60_000 });
    await record("visible-read-error");
    injectListError = false;
    await loadError.getByRole("button", { name: "Retry", exact: true }).click();
    stage = "queue-ready";
    const row = page.locator(`[data-work-item-id="${config.workItemId}"]`);
    await row.getByRole("heading", { name: config.jobTitle, exact: true }).waitFor();
    await row.getByText("Queued", { exact: true }).waitFor();
    await page
      .getByText(
        "The local companion could not be reached. Your queued work stays saved; its current execution state is unknown.",
        { exact: true },
      )
      .waitFor();
    const needsYou = page.locator("[data-work-item-id]").filter({
      has: page.getByRole("heading", { name: "Queue UI needs your answer", exact: true }),
    });
    await needsYou.getByText("Needs you", { exact: true }).waitFor();
    await record("offline-queued-and-needs-you");
    stage = "activity";
    await row.getByRole("button", { name: "View activity", exact: true }).click();
    const activity = page.getByRole("complementary", { name: "Queue activity" });
    await activity.getByText("Queue activity", { exact: true }).waitFor();
    await activity.getByRole("heading", { name: config.jobTitle, exact: true }).waitFor();
    await record("activity-detail");
    await activity.getByRole("button", { name: "Close activity", exact: true }).click();
    stage = "pause";
    await row.getByRole("button", { name: "Pause", exact: true }).click();
    await row.getByText("Paused", { exact: true }).waitFor();
    await record("paused");
    stage = "resume";
    await row.getByRole("button", { name: "Resume", exact: true }).click();
    await row.getByText("Queued", { exact: true }).waitFor();
    await record("resumed-queued");
    stage = "stop";
    await row.getByRole("button", { name: "Stop", exact: true }).click();
    await row.getByText("Stopped", { exact: true }).waitFor();
    await record("stopped");
    stage = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await row.getByRole("heading", { name: config.jobTitle, exact: true }).waitFor();
    await row.getByText("Stopped", { exact: true }).waitFor();
    if (await row.getByRole("button", { name: "Resume", exact: true }).count())
      throw new Error("Stopped work exposes replay");
    await record("stopped-persists-after-reload");
    if (JSON.stringify(controls) !== JSON.stringify(["pause", "resume", "stop"]))
      throw new Error("Unexpected control request sequence");
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        modelCalls: 0,
        observations,
        controls,
        blockedRequests,
        screenshots,
      }),
    );
  } catch (error) {
    let screenshot;
    if (new URL(page.url()).pathname === "/queue") {
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
        controls,
        blockedRequests,
        screenshots,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observeQueueUi(environment, config) {
  for (const value of [config.webUrl, config.apiUrl, config.cdpUrl]) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new Error("Queue UI regression requires loopback origins");
  }
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(config.workItemId))
    throw new Error("Queue UI regression requires one synthetic work item ID");
  const { outputDir, ...guestConfig } = config;
  const script = `const queueUiRequestAllowed = ${queueUiRequestAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(guestConfig)});`;
  return runGuestObserver(environment, script, outputDir);
}
