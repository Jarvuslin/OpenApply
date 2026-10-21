import {
  fillOwnedPage,
  preparationFieldProblem,
  preparationValueValid,
  readNativePreparationValue,
} from "./preparation-fill.mjs";
import { collectionTarget, collectionUrlAllowed, sameJobUrl } from "./question-collector.mjs";
import { extractQuestions } from "./question-dom.mjs";
import { scorePagesValid, scorePageUrl, scoreSiteAllowed } from "./score-pages.mjs";

async function workerBrowserMain(lines) {
  const fs = await import("node:fs/promises");
  const { chromium } = await import(
    "file:///home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  let context,
    owner,
    page,
    timer,
    retentionTimer,
    frozen = true,
    released = false,
    preparedHash,
    inspected = false,
    browserPid,
    profile;
  const sockets = new Set();
  let requests = 0,
    blockedRequests = 0,
    busy = false,
    closing = false;
  const openJobUrl = (value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password &&
        value.length <= 4000
      );
    } catch {
      return false;
    }
  };
  const id = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const reply = (requestId, result) =>
    process.stdout.write(JSON.stringify({ requestId, ok: true, result }) + "\n");
  const retainedSize = async (directory, limit) => {
    let bytes = 0,
      entries = 0;
    const visit = async (path) => {
      for (const entry of await fs.readdir(path, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })) {
        if (++entries > 50000) throw new Error("Retained browser evidence entry limit reached");
        const next = `${path}/${entry.name}`;
        if (entry.isDirectory()) await visit(next);
        else {
          const entrySize = await fs.lstat(next).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          bytes += entrySize?.size ?? 0;
          if (bytes > limit) throw new Error("Retained browser evidence byte limit reached");
        }
      }
    };
    await visit(directory);
  };
  const closeOwnedBrowser = async () => {
    clearInterval(retentionTimer);
    for (const socket of sockets) socket.close();
    const exists = async () =>
      browserPid &&
      (await fs
        .readFile(`/proc/${browserPid}/cmdline`, "utf8")
        .then((value) => value.split("\0").includes(`--user-data-dir=${profile}`))
        .catch(() => false));
    let closeTimer;
    await Promise.race([
      context?.close().catch(() => {}),
      new Promise((resolve) => {
        closeTimer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(closeTimer);
    if (await exists()) {
      const stat = await fs.readFile(`/proc/${browserPid}/stat`, "utf8");
      const group = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
      try {
        process.kill(group === browserPid ? -browserPid : browserPid, "SIGKILL");
      } catch {}
      for (let count = 0; count < 50 && (await exists()); count++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      if (await exists()) process.exitCode = 1;
    }
  };
  const stop = async () => {
    if (closing) return;
    closing = true;
    frozen = true;
    released = false;
    clearTimeout(timer);
    await closeOwnedBrowser();
    lines.close();
    process.stdin.destroy();
  };
  const renew = (ttl) => {
    if (!Number.isInteger(ttl) || ttl < 1000 || ttl > 90000 || closing)
      throw new Error("Invalid deadline");
    clearTimeout(timer);
    timer = setTimeout(() => {
      void stop();
    }, ttl);
  };
  // Scoring only reads the run's own postings: GET/HEAD without cookies, and a top-level page may
  // open only a listed posting. Scripts and styles from other sites still load so boards render.
  const scoreRoute = async (route, request) => {
    if (!["GET", "HEAD"].includes(request.method())) {
      blockedRequests++;
      return route.abort("blockedbyclient");
    }
    const topLevel = request.isNavigationRequest() && !request.frame().parentFrame();
    const loopback = owner.allowLoopback === true;
    let address = request.url();
    for (let hop = 0; hop < 4; hop++) {
      if (++requests > 3000 || !scorePageUrl(address, loopback))
        return route.abort("blockedbyclient");
      if (topLevel && !scoreSiteAllowed(owner.urls, address, loopback))
        return route.abort("blockedbyclient");
      const headers = { ...request.headers() };
      delete headers.cookie;
      delete headers.authorization;
      const response = await route
        .fetch({ url: address, headers, maxRedirects: 0, timeout: 15000 })
        .catch(() => null);
      if (!response) return route.abort("blockedbyclient");
      if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
        address = new URL(response.headers().location, address).href;
        continue;
      }
      return route.fulfill({ response });
    }
    return route.abort("blockedbyclient");
  };
  const route = async (route) => {
    const request = route.request();
    if (closing) return route.abort("blockedbyclient");
    if (owner?.mode === "score") return scoreRoute(route, request);
    if (released) return route.continue();
    if (frozen || !["GET", "HEAD"].includes(request.method())) {
      blockedRequests++;
      return route.abort("blockedbyclient");
    }
    let address = request.url();
    for (let hop = 0; hop < 4; hop++) {
      const url = new URL(address);
      if (
        ++requests > 160 ||
        url.origin !== new URL(owner.url).origin ||
        url.username ||
        url.password ||
        (request.isNavigationRequest() && !sameJobUrl(owner.url, address, owner.allowLoopback))
      )
        return route.abort("blockedbyclient");
      const headers = { ...request.headers() };
      delete headers.cookie;
      delete headers.authorization;
      const response = await route
        .fetch({ url: address, headers, maxRedirects: 0, timeout: 15000 })
        .catch(() => null);
      if (!response) return route.abort("blockedbyclient");
      if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
        address = new URL(response.headers().location, address).href;
        continue;
      }
      return route.fulfill({ response });
    }
    return route.abort("blockedbyclient");
  };
  const execute = async (command) => {
    if (command.action === "start") {
      const scoring = command.mode === "score";
      if (
        owner ||
        !["application", "intake_prepare", "score"].includes(command.mode) ||
        !["runtimeId", "workerId", "executionId", "browserSessionId", "workItemId"].every((key) =>
          id(command[key]),
        ) ||
        (scoring
          ? command.jobId !== undefined ||
            command.url !== undefined ||
            !scorePagesValid(command.urls, command.allowLoopback === true)
          : !id(command.jobId) ||
            !(
              collectionUrlAllowed(command.url, command.allowLoopback === true) ||
              (command.mode === "application" && openJobUrl(command.url))
            ))
      )
        throw new Error("Invalid ownership");
      owner = command;
      if (scoring) frozen = false;
      // The agent reviews every field and submission stays behind checkpoint and begin, so a
      // locked pre-fill phase only blocked runs. Fixtures keep it to test pre-fill itself.
      if (
        !scoring &&
        (command.allowLoopback !== true || !collectionUrlAllowed(command.url, true))
      ) {
        released = true;
        frozen = false;
      }
      renew(command.ttlMs);
      const root = "/home/pilot/openapply/queue-workers";
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      // Evidence older than three days has outlived any review, so it no longer counts toward the cap.
      for (const name of await fs.readdir(root)) {
        const entry = await fs.stat(`${root}/${name}`).catch(() => null);
        if (entry?.isDirectory() && Date.now() - entry.mtimeMs > 3 * 86400000)
          await fs.rm(`${root}/${name}`, { recursive: true, force: true });
      }
      const retained = await fs.readdir(root);
      if (retained.length >= 100) throw new Error("Retained browser evidence limit reached");
      await retainedSize(root, 1000000000);
      const directory = `${root}/${owner.browserSessionId}`;
      await fs.mkdir(directory, { mode: 0o700 });
      await fs.writeFile(
        `${directory}/ownership.json`,
        JSON.stringify({
          runtimeId: owner.runtimeId,
          workerId: owner.workerId,
          executionId: owner.executionId,
          browserSessionId: owner.browserSessionId,
          workItemId: owner.workItemId,
          jobId: owner.jobId ?? null,
        }),
        { flag: "wx", mode: 0o600 },
      );
      profile = `${directory}/profile`;
      context = await chromium.launchPersistentContext(profile, {
        executablePath: "/usr/bin/chromium",
        headless: command.mode === "intake_prepare" || command.headless === true,
        viewport: { width: 1280, height: 720 },
        serviceWorkers: "block",
        acceptDownloads: false,
        permissions: [],
        args: [
          "--no-sandbox",
          ...(command.mode === "application" || scoring
            ? ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"]
            : []),
          "--disk-cache-size=1048576",
        ],
        env: { PATH: process.env.PATH, HOME: "/home/pilot", DISPLAY: ":99" },
        timeout: 15000,
      });
      const candidates = [];
      for (const entry of await fs.readdir("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        const args = await fs.readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
        if (args.split("\0").includes(`--user-data-dir=${profile}`) && !args.includes("--type="))
          candidates.push(Number(entry));
      }
      if (candidates.length !== 1) throw new Error("Cannot verify owned browser process");
      browserPid = candidates[0];
      if (closing) {
        await closeOwnedBrowser();
        throw new Error("Stopped");
      }
      let checking = false;
      retentionTimer = setInterval(async () => {
        if (checking || closing) return;
        checking = true;
        try {
          await retainedSize(directory, 100000000);
        } catch {
          process.exitCode = 1;
          await stop();
        } finally {
          checking = false;
        }
      }, 5000);
      await context.route("**/*", route);
      await context.routeWebSocket("**/*", (socket) => {
        if (!released || closing) {
          socket.close();
          return;
        }
        sockets.add(socket);
        sockets.add(socket.connectToServer());
      });
      await context.exposeFunction("__openapplyWorkerReleased", () => released && !closing);
      await context.addInitScript(() => {
        window.__openapplyPreparationFrozen = true;
        void window.__openapplyWorkerReleased().then((value) => {
          window.__openapplyPreparationFrozen = !value;
        });
        for (const key of ["submit", "requestSubmit"]) {
          const original = HTMLFormElement.prototype[key];
          HTMLFormElement.prototype[key] = function (...args) {
            if (window.__openapplyPreparationFrozen) throw new Error("Preparation cannot submit");
            return original.apply(this, args);
          };
        }
        document.addEventListener(
          "submit",
          (event) => {
            if (window.__openapplyPreparationFrozen) event.preventDefault();
          },
          true,
        );
        const original = window.open;
        window.open = function (...args) {
          return window.__openapplyPreparationFrozen ? null : original.apply(this, args);
        };
        const beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = (...args) => !window.__openapplyPreparationFrozen && beacon(...args);
      });
      page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(3000);
      if (command.mode === "intake_prepare") return { port: 0, outputDir: directory };
      const portFile = await fs.readFile(`${directory}/profile/DevToolsActivePort`, "utf8");
      const port = Number(portFile.split("\n")[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 9222)
        throw new Error("Invalid isolated browser port");
      return { port, outputDir: directory, released };
    }
    if (!context || closing) throw new Error("No owned browser");
    if (command.action === "renew") {
      renew(command.ttlMs);
      return { renewed: true };
    }
    if (command.action === "close") {
      await stop();
      return { closed: true };
    }
    if (command.action === "frame") {
      if (
        command.workItemId !== owner.workItemId ||
        command.executionId !== owner.executionId ||
        command.browserSessionId !== owner.browserSessionId ||
        !page ||
        page.isClosed()
      )
        throw new Error("Wrong owned frame");
      const viewport = page.viewportSize();
      if (!viewport || viewport.width > 1920 || viewport.height > 1080)
        throw new Error("Unbounded viewport");
      const bytes = await page.screenshot({
        type: "jpeg",
        quality: 55,
        fullPage: false,
        timeout: 1500,
      });
      if (closing || bytes.length > 640000) throw new Error("Frame byte limit or closed worker");
      return {
        workItemId: owner.workItemId,
        executionId: owner.executionId,
        browserSessionId: owner.browserSessionId,
        capturedAt: new Date().toISOString(),
        mimeType: "image/jpeg",
        imageBase64: bytes.toString("base64"),
        width: viewport.width,
        height: viewport.height,
      };
    }
    if (command.action === "inspect") {
      if (owner.mode !== "intake_prepare" || inspected || released)
        throw new Error("Read-only intake inspection is unavailable");
      inspected = true;
      try {
        frozen = false;
        const response = await page.goto(owner.url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        if (!response?.ok() || !sameJobUrl(owner.url, page.url(), owner.allowLoopback))
          throw new Error("Wrong posting");
        const postingUrl = page.url();
        const posting = await page.evaluate(() => {
          const text = (document.querySelector("main") ?? document.body)?.innerText ?? "";
          return {
            description: text.length <= 100000 ? text : null,
            truncated: text.length > 100000,
          };
        });
        const target = collectionTarget(owner.url);
        if (target !== page.url()) {
          const form = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
          if (!form?.ok() || !sameJobUrl(owner.url, page.url(), owner.allowLoopback))
            throw new Error("Wrong application page");
        }
        frozen = true;
        const questions = await page.evaluate(extractQuestions);
        if (blockedRequests > 0 && questions.coverage === "complete")
          questions.coverage = "partial";
        if (blockedRequests > 0)
          questions.reason = "Some network requests were blocked. " + (questions.reason ?? "");
        return {
          postingUrl,
          ...posting,
          sourceUrl: page.url(),
          ...questions,
          submissionAllowed: false,
        };
      } finally {
        frozen = true;
      }
    }
    if (command.action === "login") {
      // The saved login goes from the host straight into the employer form; the model never sees it.
      if (
        owner.mode !== "application" ||
        !released ||
        typeof command.email !== "string" ||
        typeof command.password !== "string" ||
        !command.email ||
        !command.password
      )
        throw new Error("Sign-in is unavailable");
      const visiblePassword = (target) => target.locator('input[type="password"]:visible');
      let target = null;
      for (const candidate of context.pages().reverse())
        if (!candidate.isClosed() && (await visiblePassword(candidate).count()) > 0) {
          target = candidate;
          break;
        }
      if (!target) return { signedIn: false, reason: "no_sign_in_form" };
      const emailField = target
        .locator(
          'input[type="email"]:visible, input[autocomplete="username"]:visible, input[autocomplete="email"]:visible, [data-automation-id="email"]:visible, input[name*="email" i]:visible, input[id*="email" i]:visible',
        )
        .first();
      if ((await emailField.count()) === 0) return { signedIn: false, reason: "no_email_field" };
      await emailField.fill(command.email);
      await visiblePassword(target).first().fill(command.password);
      const submit = target
        .locator(
          '[data-automation-id="click_filter"][aria-label="Sign In"], [data-automation-id="signInSubmitButton"]',
        )
        .first();
      if ((await submit.count()) > 0) await submit.click({ force: true });
      else {
        const button = target
          .getByRole("button", { name: /^(sign in|log in|login|continue|submit)$/i })
          .first();
        if ((await button.count()) > 0) await button.click();
        else await visiblePassword(target).first().press("Enter");
      }
      await target.waitForTimeout(5000);
      const message = await target
        .locator('[role="alert"]:visible, [data-automation-id="errorMessage"]:visible')
        .first()
        .innerText({ timeout: 1000 })
        .catch(() => null);
      return {
        signedIn: (await visiblePassword(target).count()) === 0,
        message: message ? message.trim().slice(0, 300) : null,
        url: target.url().split("?")[0],
      };
    }
    if (command.action === "prepare") {
      if (
        owner.mode !== "application" ||
        preparedHash ||
        released ||
        command.config?.manifest?.mode !== "worker" ||
        command.config.manifest.job.id !== owner.jobId ||
        command.config.manifest.job.url !== owner.url ||
        command.config.manifest.submissionAllowed !== false
      )
        throw new Error("Wrong manifest");
      frozen = false;
      const response = await page.goto(collectionTarget(owner.url), {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      frozen = true;
      if (!response?.ok() || !sameJobUrl(owner.url, page.url(), owner.allowLoopback))
        throw new Error("Wrong job page");
      const result = await fillOwnedPage(page, command.config.manifest, command.config.documents, {
        networkIsolated: true,
      });
      preparedHash = command.config.manifest.manifestHash;
      return { ...result, sourceUrl: page.url() };
    }
    if (command.action === "handoff") {
      if (
        owner.mode !== "application" ||
        !preparedHash ||
        released ||
        command.manifestHash !== preparedHash ||
        !sameJobUrl(owner.url, page.url(), owner.allowLoopback)
      )
        throw new Error("Preparation changed");
      await page.evaluate(() => {
        window.__openapplyPreparationFrozen = false;
      });
      released = true;
      await page.bringToFront();
      return { released: true, submissionAllowed: false };
    }
    throw new Error("Unknown command");
  };
  lines.on("line", async (line) => {
    let command;
    try {
      if (line.length > 16000000) throw new Error("Bound");
      command = JSON.parse(line);
      if (!id(command.requestId)) throw new Error("Invalid request");
      const concurrent = ["renew", "close", "frame"].includes(command.action);
      if (!concurrent && busy) throw new Error("Browser operation in progress");
      if (!concurrent) busy = true;
      try {
        reply(command.requestId, await execute(command));
      } finally {
        if (!concurrent) busy = false;
      }
    } catch (failure) {
      if (command?.action !== "frame") frozen = true;
      process.stdout.write(
        JSON.stringify({
          requestId: command?.requestId ?? null,
          ok: false,
          error: "Owned browser operation refused or failed.",
          reason: `${command?.action ?? "request"}: ${String(failure?.message ?? failure)
            .split("\n")[0]
            .slice(0, 200)}`,
        }) + "\n",
      );
    }
  });
  lines.once("close", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
  process.stdout.write('{"ready":true}\n');
}

export function workerBrowserProgram() {
  return `const scorePageUrl=${scorePageUrl.toString()};const scorePagesValid=${scorePagesValid.toString()};const scoreSiteAllowed=${scoreSiteAllowed.toString()};const collectionUrlAllowed=${collectionUrlAllowed.toString()};const collectionTarget=${collectionTarget.toString()};const sameJobUrl=${sameJobUrl.toString()};const extractQuestions=${extractQuestions.toString()};const preparationFieldProblem=${preparationFieldProblem.toString()};const preparationValueValid=${preparationValueValid.toString()};const readNativePreparationValue=${readNativePreparationValue.toString()};const fillOwnedPage=${fillOwnedPage.toString()};export default ${workerBrowserMain.toString()};`;
}
