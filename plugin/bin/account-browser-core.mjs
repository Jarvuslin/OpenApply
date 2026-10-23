import { inspectAccountDom, installAccountFence } from "./account-browser-dom.mjs";
import {
  accountNavigationAllowed,
  accountRequestKind,
  accountTarget,
  accountVerificationInput,
} from "./account-browser-policy.mjs";

async function accountBrowserMain(lines, harness) {
  const fs = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const { chromium } = await import(
    "file:///home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const uuid = (value) =>
    typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  let owner,
    target,
    context,
    page,
    timer,
    directory,
    profile,
    statePath,
    state = {},
    closing = false,
    busy = false,
    parked = false,
    mutation = null,
    verificationLink = null,
    humanSubmitExpires = 0,
    humanAction = null,
    handoffReady = false;
  const save = () => fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const stop = async () => {
    if (closing) return;
    closing = true;
    parked = false;
    mutation = null;
    clearTimeout(timer);
    await context?.close();
    lines.close();
    process.stdin.destroy();
  };
  const deadline = (ttl, maximum = 90000) => {
    if (!Number.isInteger(ttl) || ttl < 1000 || ttl > maximum || closing)
      throw Error("Invalid account deadline");
    clearTimeout(timer);
    timer = setTimeout(() => void stop(), ttl);
  };
  const safeUrl = () => {
    const url = new URL(page.url());
    url.search = "";
    url.hash = "";
    return url.href;
  };
  const observation = (event, extra = {}) => ({
    event,
    browserSessionId: owner.browserSessionId,
    currentUrl: safeUrl(),
    ...extra,
  });
  const result = async (current) => {
    const view = await page.evaluate(inspectAccountDom);
    const output = { phase: view.view, submissionAllowed: false, runtimeHandoffRequired: true };
    if (["existing_account", "credentials_rejected", "verification", "unknown"].includes(view.view))
      handoffReady = true;
    if (view.view === "authenticated")
      output.observation = observation("authenticated", { evidence: "authenticated_session" });
    else if (view.view === "existing_account") output.observation = observation("existing_account");
    else if (view.view === "credentials_rejected")
      output.observation = observation("credentials_rejected");
    else if (view.view === "signup" && current.attempt.signupAttempts === 0)
      output.observation = observation("signup_form");
    else if (
      state.requestedAt &&
      (view.view === "verification" ||
        // A resumed step reopens on the careers home, but the sent signup still awaits its email.
        (state.signupSent && ["unknown", "signup"].includes(view.view)))
    ) {
      output.phase = "verification";
      handoffReady = true;
      output.verificationRequest = {
        email: owner.snapshot.email,
        tenantOrigin: owner.snapshot.tenantOrigin,
        requestedAt: state.requestedAt,
        senderDomains: target.fixture
          ? ["fixture.example"]
          : ["workday.com", "myworkday.com", "myworkdayjobs.com"],
        linkOrigin: target.origin,
        // Workday emails omit the site's language segment, so the agent compares without it.
        linkPathPrefix: target.path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, ""),
      };
      output.observation = observation("verification_pending", {
        requestedAt: state.requestedAt,
        recipient: owner.snapshot.email,
        senderDomains: output.verificationRequest.senderDomains,
      });
    }
    if (!output.verificationRequest && current.attempt.verification) {
      const request = current.attempt.verification;
      output.verificationRequest = {
        email: request.recipient,
        tenantOrigin: request.tenantOrigin,
        requestedAt: request.requestedAt,
        senderDomains: request.senderDomains,
        linkOrigin: target.origin,
        linkPathPrefix: target.path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, ""),
      };
    }
    if (output.verificationRequest) {
      const request = output.verificationRequest;
      output.gmailQuery = `deliveredto:"${request.email}" after:${Math.floor(Date.parse(request.requestedAt) / 1000)} {${request.senderDomains.map((domain) => `from:${domain}`).join(" ")}}`;
    }
    output.mailbox = current.attempt.mailbox;
    output.mailboxBlocked = current.attempt.mailboxBlocked;
    return output;
  };
  const acceptTerms = async () => {
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      if (!(await box.isVisible()) || (await box.isChecked()) || (await box.isDisabled())) continue;
      const consent = await box.evaluate(
        (element) =>
          element.required ||
          /terms|consent|agree|privacy/i.test(
            [
              element.getAttribute("aria-label"),
              ...[...(element.labels ?? [])].map((label) => label.textContent),
            ].join(" "),
          ),
      );
      if (consent) await box.check();
    }
  };
  const waitForViewChange = (before, timeout) =>
    page
      .waitForFunction(
        ({ inspect, before }) => new Function(`return (${inspect})()`)().view !== before,
        { inspect: inspectAccountDom.toString(), before },
        { timeout },
      )
      .catch(() => {});
  const route = async (route) => {
    const request = route.request();
    const kind = accountRequestKind(
      target,
      request.url(),
      request.method(),
      request.postData() ?? "",
    );
    let allowed = !closing && ["read", "asset"].includes(kind);
    // The verification link was already matched to this tenant, mailbox and request by accountVerificationInput.
    const ownLink = !closing && mutation === "verify" && request.url() === verificationLink;
    if (
      request.isNavigationRequest() &&
      !accountNavigationAllowed(target, request.url()) &&
      !ownLink
    )
      allowed = false;
    if (kind === "verification_link") allowed = ownLink;
    if (kind === "signup") {
      // Page scripts alone cannot sign up: only the broker's own submit or a parked human's can.
      if (parked && humanSubmitExpires <= Date.now())
        await new Promise((resolve) => setTimeout(resolve, 100));
      const submitted =
        mutation === "signup" ||
        (parked && humanAction === "signup" && humanSubmitExpires > Date.now());
      allowed = !closing && submitted && state.signupReserved === true && state.signupSent !== true;
      humanSubmitExpires = 0;
      if (allowed) {
        state.signupSent = true;
        state.requestedAt = new Date().toISOString();
        await save();
      }
    }
    if (kind === "login" || kind === "verify") {
      if (parked && humanSubmitExpires <= Date.now())
        await new Promise((resolve) => setTimeout(resolve, 100));
      allowed =
        !closing &&
        (mutation === kind || (parked && humanAction === kind && humanSubmitExpires > Date.now()));
      humanSubmitExpires = 0;
      if (allowed) mutation = null;
    }
    if (!allowed) return route.abort("blockedbyclient");
    const response = await route.fetch({ maxRedirects: 0, timeout: 15000 }).catch(() => null);
    if (!response) return route.abort("blockedbyclient");
    const location = response.headers().location;
    if (location) {
      const next = new URL(location, request.url()).href;
      const nextKind = accountRequestKind(target, next, "GET");
      let redirectAllowed = accountNavigationAllowed(target, next);
      if (!request.isNavigationRequest() && kind === "asset")
        redirectAllowed = nextKind === "asset";
      if (!request.isNavigationRequest() && kind === "read")
        redirectAllowed = ["read", "asset"].includes(nextKind);
      if (!redirectAllowed) return route.abort("blockedbyclient");
    }
    return route.fulfill({ response });
  };
  const start = async (command) => {
    if (
      owner ||
      command.mode !== "account_setup" ||
      !["runtimeId", "workerId", "executionId", "browserSessionId", "workItemId"].every((key) =>
        uuid(command[key]),
      ) ||
      command.snapshot.workItemId !== command.workItemId ||
      command.jobId ||
      command.apiToken
    )
      throw Error("Invalid account owner");
    target = accountTarget(command.snapshot, command.allowLoopback === true);
    owner = command;
    deadline(command.ttlMs);
    directory = `/home/pilot/openapply/queue-workers/${owner.browserSessionId}`;
    const accountDirectory = `/home/pilot/openapply/queue-accounts/${owner.workItemId}`;
    await fs.mkdir("/home/pilot/openapply/queue-workers", { recursive: true, mode: 0o700 });
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.mkdir(accountDirectory, { recursive: true, mode: 0o700 });
    statePath = `${accountDirectory}/state.json`;
    const saved = await fs.readFile(statePath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (saved) {
      state = JSON.parse(saved);
      if (
        state.tenantOrigin !== owner.snapshot.tenantOrigin ||
        state.workItemId !== owner.workItemId
      )
        throw Error("Wrong retained account");
    } else {
      state = {
        workItemId: owner.workItemId,
        tenantOrigin: owner.snapshot.tenantOrigin,
        signupReserved: false,
        signupSent: false,
      };
      await save();
    }
    profile = `${accountDirectory}/profile`;
    context = await chromium.launchPersistentContext(profile, {
      executablePath: "/usr/bin/chromium",
      headless: command.headless === true,
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      args: ["--no-sandbox", "--disk-cache-size=1048576"],
      env: { PATH: process.env.PATH, HOME: "/home/pilot", DISPLAY: ":99" },
      timeout: 15000,
    });
    await context.route("**/*", route);
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const binding = `account_${randomUUID().replaceAll("-", "")}`;
    await context.exposeBinding(binding, (source, kind) => {
      if (
        source.page === page &&
        source.frame === page.mainFrame() &&
        parked &&
        ["signup", "login", "verify"].includes(kind)
      ) {
        humanAction = kind;
        humanSubmitExpires = Date.now() + 1500;
      }
    });
    await context.addInitScript(installAccountFence, { binding, email: owner.snapshot.email });
    page = context.pages()[0] ?? (await context.newPage());
    for (const other of context.pages()) if (other !== page) await other.close();
    context.on("page", (other) => {
      if (other !== page) void other.close();
    });
    page.setDefaultTimeout(3000);
    await harness?.({ page });
    await page.goto(owner.snapshot.signupUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button,a,[role=button]")].some((element) =>
            /^(?:Sign In|Sign in with email|Create Account|Sign Out|Log Out)$/i.test(
              element.textContent?.trim() ?? "",
            ),
          ),
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    return { port: 0, outputDir: directory };
  };
  const operate = async (command) => {
    if (command.action === "start") return start(command);
    if (!context || closing) throw Error("No account browser");
    if (command.action === "close") {
      await stop();
      return { closed: true };
    }
    if (command.action === "renew") {
      if (parked) throw Error("Account is parked");
      deadline(command.ttlMs);
      return { renewed: true };
    }
    if (command.action === "park") {
      if (!handoffReady) throw Error("No account handoff");
      parked = true;
      mutation = null;
      deadline(command.ttlMs, 900000);
      await page.bringToFront();
      return { parked: true, submissionAllowed: false };
    }
    if (command.action === "frame") {
      if (
        ["workItemId", "executionId", "browserSessionId"].some((key) => command[key] !== owner[key])
      )
        throw Error("Wrong frame owner");
      const bytes = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
      if (bytes.length > 640000) throw Error("Frame too large");
      return {
        workItemId: owner.workItemId,
        executionId: owner.executionId,
        browserSessionId: owner.browserSessionId,
        capturedAt: new Date().toISOString(),
        mimeType: "image/jpeg",
        imageBase64: bytes.toString("base64"),
        width: 1280,
        height: 720,
      };
    }
    if (command.action !== "account" || parked) throw Error("Account-only command required");
    const current = command.context;
    if (
      !current ||
      current.snapshot.snapshotHash !== owner.snapshot.snapshotHash ||
      current.snapshot.workItemId !== owner.workItemId
    )
      throw Error("Wrong account scope");
    if (current.attempt.signupAttempts === 1) {
      state.signupReserved = true;
      await save();
    }
    const input = command.input ?? {};
    const view = await page.evaluate(inspectAccountDom);
    if (command.operation === "inspect") {
      for (let step = 0; step < 3; step++) {
        const currentView = await page.evaluate(inspectAccountDom);
        if (
          [
            "signup",
            "authenticated",
            "verification",
            "existing_account",
            "credentials_rejected",
            "application_blocked",
          ].includes(currentView.view)
        )
          break;
        const existingLogin = ["existing", "authenticated"].includes(
          current.attempt.credentialPurpose,
        );
        if (currentView.view === "login" && existingLogin) break;
        const labels = existingLogin
          ? ["Sign in with email", "Sign In"]
          : ["Create Account", "Sign in with email", "Sign In"];
        const label = labels.find((value) => currentView.accountButtons.includes(value));
        if (!label) break;
        const button = page.getByRole("button", { name: label, exact: true });
        if ((await button.count()) !== 1) break;
        await button.click();
        await page
          .waitForFunction(
            ({ inspect, before }) => new Function(`return (${inspect})()`)().view !== before,
            { inspect: inspectAccountDom.toString(), before: currentView.view },
            { timeout: 3000 },
          )
          .catch(() => {});
      }
      return result(current);
    }
    if (command.operation === "signup") {
      const credential = command.credential;
      if (
        view.view !== "signup" ||
        current.attempt.signupAttempts !== 1 ||
        !current.attempt.begunAt ||
        state.signupSent ||
        current.snapshot.operation !== "signup" ||
        credential?.email !== owner.snapshot.email ||
        credential?.credentialId !== owner.snapshot.credentialId ||
        typeof credential.password !== "string"
      )
        throw Error("Signup unavailable");
      state.signupReserved = true;
      await save();
      await page.getByRole("textbox", { name: /email address/i }).fill(credential.email);
      const passwords = page.locator('input[type="password"]');
      await passwords.nth(0).fill(credential.password);
      await passwords.nth(1).fill(credential.password);
      await acceptTerms();
      // The site may send its signup request after click() resolves, so keep the permit until the page moves on.
      mutation = "signup";
      try {
        await page.getByRole("button", { name: "Create Account", exact: true }).click();
        await waitForViewChange("signup", 10000);
      } finally {
        mutation = null;
      }
      return result(current);
    }
    if (command.operation === "verification_context") {
      // The one Gmail search must not run before the employer's email can arrive; the host waits 60s per call.
      const settle = Date.parse(state.requestedAt ?? "") + 40000 - Date.now();
      if (settle > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(settle, 35000)));
      return result(current);
    }
    if (command.operation === "request_help") {
      if (
        ![
          "existing_account_credentials",
          "password_entry",
          "terms_confirmation",
          "mailbox_identity",
          "verification",
          "captcha",
        ].includes(input.reason)
      )
        throw Error("Invalid account question");
      handoffReady = true;
      return {
        phase: "needs_user",
        reason: input.reason,
        observation: observation("needs_user", { reason: input.reason }),
        submissionAllowed: false,
      };
    }
    if (command.operation === "login") {
      const credential = command.credential;
      if (
        view.view !== "login" ||
        !["existing", "authenticated"].includes(current.attempt.credentialPurpose) ||
        credential?.email !== owner.snapshot.email ||
        credential?.credentialId !== owner.snapshot.credentialId ||
        typeof credential.password !== "string"
      )
        throw Error("Existing login unavailable");
      await page.getByRole("textbox", { name: /email address/i }).fill(credential.email);
      await page.locator('input[type="password"]').fill(credential.password);
      await acceptTerms();
      mutation = "login";
      try {
        await page.getByRole("button", { name: /^(Sign In|Submit|Log In)$/i }).click();
      } finally {
        mutation = null;
      }
      await page
        .waitForFunction(
          (inspect) => new Function(`return (${inspect})()`)().view !== "login",
          inspectAccountDom.toString(),
          { timeout: 3000 },
        )
        .catch(() => {});
      return result(current);
    }
    if (command.operation === "verify") {
      const request = (await result(current)).verificationRequest;
      if (
        (view.view !== "verification" && !(state.signupSent && input.link)) ||
        current.attempt.mailboxBlocked ||
        !accountVerificationInput(request, input)
      )
        throw Error("Verification scope mismatch");
      await acceptTerms();
      mutation = "verify";
      try {
        if (input.code) {
          await page
            .getByRole("textbox", {
              name: /^(verification|security|one.time|confirmation) code\b/i,
            })
            .fill(input.code);
          await page
            .getByRole("button", { name: /^(Verify|Verify Email|Verify Account|Confirm Code)$/i })
            .click();
        } else {
          verificationLink = input.link;
          // Workday posts its activation after load, so the verify window stays open until the network settles.
          await page.goto(input.link, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
        }
      } finally {
        mutation = null;
        verificationLink = null;
      }
      await page
        .waitForFunction(
          (inspect) => new Function(`return (${inspect})()`)().view !== "verification",
          inspectAccountDom.toString(),
          { timeout: 3000 },
        )
        .catch(() => {});
      return result(current);
    }
    throw Error("Unsupported account operation");
  };
  lines.on("line", async (line) => {
    let command;
    try {
      if (line.length > 60000) throw Error("Input too large");
      command = JSON.parse(line);
      if (!uuid(command.requestId)) throw Error("Invalid request");
      const concurrent = ["renew", "close"].includes(command.action);
      if (!concurrent && busy) throw Error("Account operation busy");
      if (!concurrent) busy = true;
      try {
        process.stdout.write(
          JSON.stringify({
            requestId: command.requestId,
            ok: true,
            result: await operate(command),
          }) + "\n",
        );
      } finally {
        if (!concurrent) busy = false;
      }
    } catch (failure) {
      mutation = null;
      process.stdout.write(
        JSON.stringify({
          requestId: command?.requestId ?? null,
          ok: false,
          error: "Account-only operation refused or failed.",
          reason: `${command?.action ?? "request"}: ${String(failure?.message ?? failure)
            .split("\n")[0]
            .slice(0, 200)}`,
        }) + "\n",
      );
    }
  });
  lines.once("close", () => void stop());
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  process.stdout.write('{"ready":true}\n');
}

export function accountBrowserProgram() {
  return `const accountTarget=${accountTarget.toString()};const accountRequestKind=${accountRequestKind.toString()};const accountNavigationAllowed=${accountNavigationAllowed.toString()};const accountVerificationInput=${accountVerificationInput.toString()};const inspectAccountDom=${inspectAccountDom.toString()};const installAccountFence=${installAccountFence.toString()};export default ${accountBrowserMain.toString()};`;
}
