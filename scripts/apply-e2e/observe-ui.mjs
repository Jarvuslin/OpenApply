import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function uiRequestAllowed(method, address, config) {
  const url = new URL(address);
  const local =
    [config.webUrl, config.apiUrl].includes(url.origin) && !url.username && !url.password;
  const normalLogin =
    url.origin === config.apiUrl &&
    ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(url.pathname);
  return (
    local && (["GET", "HEAD", "OPTIONS"].includes(method) || (method === "POST" && normalLogin))
  );
}

export function uiFailureRouteAllowed(address, webUrl) {
  const url = new URL(address);
  return (
    url.origin === webUrl &&
    (/^\/(dashboard|applications|analytics)$/.test(url.pathname) ||
      /^\/applications\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(url.pathname))
  );
}

async function observeInGuest(config) {
  const { chromium } = await import(
    "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(config.uiReadOnly ? { serviceWorkers: "block" } : {}),
  });
  const blockedRequests = [];
  if (config.uiReadOnly) {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (uiRequestAllowed(request.method(), request.url(), config)) {
        await route.continue();
      } else {
        blockedRequests.push({
          origin: url.origin,
          pathname: url.pathname,
          method: request.method(),
        });
        await route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      if (url.origin === config.webUrl) socket.connectToServer();
      else socket.close();
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const pages = [];
  let stage = "login-navigation";
  let route = "/login";
  let httpStatus;
  try {
    const login = await page.goto(`${config.webUrl}/login?next=/dashboard`, {
      waitUntil: "domcontentloaded",
    });
    httpStatus = login?.status();
    stage = "login-form";
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(config.loginEmail);
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    stage = "authenticated-redirect";
    await page.waitForURL(`${config.webUrl}/dashboard`, { timeout: 60_000 });
    const targets = [
      { path: "/dashboard", heading: "Dashboard", stats: ["Applied"] },
      { path: "/applications", heading: "Applications", stats: [] },
      { path: "/analytics", heading: "Analytics", stats: ["Total", "Submitted"] },
    ];
    for (const target of targets) {
      route = target.path;
      stage = "page-navigation";
      httpStatus = undefined;
      const response = await page.goto(`${config.webUrl}${target.path}`, {
        waitUntil: "domcontentloaded",
      });
      httpStatus = response?.status();
      stage = "page-heading";
      await page.getByRole("heading", { name: target.heading, exact: true }).waitFor();
      for (let pass = 0; pass < 2; pass++) {
        if (pass) {
          stage = "page-reload";
          httpStatus = undefined;
          const response = await page.reload({ waitUntil: "domcontentloaded" });
          httpStatus = response?.status();
        }
        stage = "page-observations";
        const observations = [];
        for (const label of target.stats) {
          stage = `statistic-${label.toLowerCase()}`;
          const card = page
            .locator(".MuiCard-root")
            .filter({ has: page.getByText(label, { exact: true }) })
            .filter({ has: page.locator(".MuiTypography-statValue") });
          await card.getByText(String(config.expected), { exact: true }).waitFor();
          observations.push({ label, displayed: await card.innerText() });
        }
        if (target.path === "/applications") {
          for (const application of config.applications) {
            stage = "application-company";
            const row = page
              .getByRole("row")
              .filter({ has: page.locator(`a[href="/applications/${application.id}"]`) });
            await row.getByText(application.company, { exact: true }).waitFor();
            stage = "application-status";
            await row.getByText("Submitted", { exact: true }).waitFor();
            observations.push({
              applicationId: application.id,
              persistedStatus: "applied",
              displayedStatus: "Submitted",
              displayed: await row.innerText(),
            });
          }
          if ((await page.locator("tbody tr").count()) !== config.expected)
            throw new Error("Unexpected application row count");
        }
        const errors = await page.getByRole("alert").allTextContents();
        if (errors.some((text) => /could not|unable to|failed|error/i.test(text)))
          throw new Error("Rendered page contains a load error");
        pages.push({
          route: target.path,
          reload: Boolean(pass),
          url: page.url(),
          observations,
          screenshot: (await page.screenshot({ fullPage: true })).toString("base64"),
        });
      }
    }
    for (const application of config.applications) {
      route = `/applications/${application.id}`;
      stage = "receipt-navigation";
      httpStatus = undefined;
      const response = await page.goto(`${config.webUrl}${route}`, {
        waitUntil: "domcontentloaded",
      });
      httpStatus = response?.status();
      stage = "receipt-observation";
      await page.getByText(application.receiptId, { exact: true }).waitFor();
      pages.push({
        route: `/applications/${application.id}`,
        url: page.url(),
        observations: [{ receiptReference: application.receiptId, observed: true }],
        screenshot: (await page.screenshot({ fullPage: true })).toString("base64"),
      });
    }
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        pages,
        ...(config.uiReadOnly ? { blockedRequests } : {}),
      }),
    );
  } catch (error) {
    let diagnostics;
    if (uiFailureRouteAllowed(page.url(), config.webUrl)) {
      try {
        const clipped = (values) => values.slice(0, 12).map((value) => value.slice(0, 1600));
        diagnostics = {
          headings: clipped(await page.getByRole("heading").allTextContents()),
          alerts: clipped(await page.getByRole("alert").allTextContents()),
          applicationRows: clipped(await page.locator("tbody tr").allTextContents()),
          applicationLinks: await page.locator('a[href^="/applications/"]').evaluateAll((links) =>
            links.slice(0, 12).map((link) => ({
              href: link.getAttribute("href"),
              text: link.textContent?.slice(0, 200),
            })),
          ),
          screenshot: (
            await page.screenshot({
              fullPage: true,
              mask: [page.locator("input"), page.locator("textarea")],
            })
          ).toString("base64"),
        };
      } catch {}
    }
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        reason: "Authenticated rendered UI check failed; retained completed page observations",
        failure: {
          stage,
          route,
          httpStatus,
          errorClass: error?.name === "TimeoutError" ? "TimeoutError" : "Error",
          ...(diagnostics ? { diagnostics } : {}),
        },
        pages,
        ...(config.uiReadOnly ? { blockedRequests } : {}),
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function observeUi(environment, applicant, applications, evidenceDir) {
  const config = {
    webUrl: environment.webUrl,
    cdpUrl: environment.cdpUrl,
    loginEmail: applicant.loginEmail,
    password: applicant.password,
    expected: environment.fixtureManifest.cases.length,
    applications,
    ...(environment.uiReadOnly ? { uiReadOnly: true, apiUrl: environment.apiUrl } : {}),
  };
  const script = `const uiRequestAllowed = ${uiRequestAllowed.toString()}; const uiFailureRouteAllowed = ${uiFailureRouteAllowed.toString()}; await (${observeInGuest.toString()})(${JSON.stringify(config)});`;
  const result = JSON.parse(
    await environment.guestCommand(["node", "--input-type=module"], {
      input: script,
      timeout: 300_000,
    }),
  );
  const directory = join(evidenceDir, "ui");
  await mkdir(directory, { recursive: true });
  for (const [index, page] of result.pages.entries()) {
    const screenshot = join(
      directory,
      `${index + 1}-${page.route.split("/").filter(Boolean).join("-")}.png`,
    );
    await writeFile(screenshot, Buffer.from(page.screenshot, "base64"));
    page.screenshot = screenshot;
  }
  if (result.failure?.diagnostics?.screenshot) {
    const screenshot = join(directory, "failure.png");
    await writeFile(screenshot, Buffer.from(result.failure.diagnostics.screenshot, "base64"));
    result.failure.diagnostics.screenshot = screenshot;
  }
  await writeFile(join(directory, "observations.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
