export function accountTarget(snapshot, allowLoopback = false) {
  const url = new URL(snapshot.signupUrl);
  const origin = new URL(snapshot.tenantOrigin);
  const fixture = allowLoopback && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    snapshot.version !== 2 ||
    snapshot.purpose !== "account_setup" ||
    snapshot.provider !== "claude" ||
    snapshot.submissionAllowed !== false ||
    snapshot.maxSignupAttempts !== 1 ||
    url.origin !== origin.href.replace(/\/$/, "") ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (!fixture &&
      (url.protocol !== "https:" ||
        !/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(url.hostname))) ||
    /\/(?:job|apply|application)(?:\/|$)/i.test(url.pathname)
  )
    throw Error("Unsupported account-only target");
  const realm = fixture ? null : url.hostname.split(".")[1];
  return {
    origin: url.origin,
    path: url.pathname.replace(/\/$/, ""),
    tenant: fixture ? null : url.hostname.split(".")[0],
    fixture,
    assetOrigins: realm
      ? [`https://${realm}.myworkday.com`, `https://${realm}.myworkdaycdn.com`]
      : [],
  };
}

export function accountRequestKind(target, address, method, body = "") {
  let url;
  try {
    url = new URL(address);
  } catch {
    return "deny";
  }
  if (url.username || url.password || url.hash) return "deny";
  if (url.origin !== target.origin) {
    const staticAsset =
      target.assetOrigins.includes(url.origin) &&
      /^\/wday\/asset\/[a-zA-Z0-9_./-]+\.(?:js|css|json|woff2?|ttf|svg|png|jpg|gif)$/i.test(
        url.pathname,
      ) &&
      !url.search;
    return staticAsset && ["GET", "HEAD"].includes(method) ? "asset" : "deny";
  }
  const path = url.pathname;
  if (/\/(?:jobApplication|applications?|apply|upload|attachments?|resumes?)(?:\/|$)/i.test(path))
    return "deny";
  if (["GET", "HEAD"].includes(method)) {
    if (
      [...url.searchParams.keys()].some((key) => /password|secret|token|code|otp/i.test(key)) ||
      (/\/(activate|verifyEmail|verifyAccount|verifyCode)$/.test(path) && url.search)
    )
      return "verification_link";
    return "read";
  }
  if (method !== "POST" || url.search || body.length > 16000) return "deny";
  const accountPath = path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "");
  const basePath = target.path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "");
  if (accountPath === `${basePath}/register`) return "signup";
  if (accountPath === `${basePath}/login`) return "login";
  if (
    ["activate", "verifyEmail", "verifyAccount", "verifyCode"].some(
      (action) => accountPath === `${basePath}/${action}`,
    )
  )
    return "verify";
  const match =
    /^\/wday\/authgwy\/([^/]+)\/(createAccount|login|verifyEmail|verifyAccount|validateToken|verifyCode)\/?$/i.exec(
      path,
    );
  if (match && match[1] !== target.tenant) return "deny";
  const fixtureMatch = target.fixture && /^\/account\/(signup|login|verify)$/.exec(path);
  const action = (match?.[2] ?? fixtureMatch?.[1] ?? "").toLowerCase();
  if (["createaccount", "signup"].includes(action)) return "signup";
  if (action === "login") return "login";
  if (["verifyemail", "verifyaccount", "validatetoken", "verifycode", "verify"].includes(action))
    return "verify";
  if (path === `/wday/cxs/${target.tenant}${basePath}/jobs`) {
    try {
      const input = JSON.parse(body);
      if (
        body.length <= 4000 &&
        input &&
        !Array.isArray(input) &&
        Object.keys(input).every((key) =>
          ["limit", "offset", "searchText", "appliedFacets"].includes(key),
        )
      )
        return "read";
    } catch {}
  }
  return "deny";
}

export function accountNavigationAllowed(target, address) {
  try {
    const url = new URL(address);
    if (url.origin !== target.origin || url.username || url.password || url.hash) return false;
    const path = url.pathname.replace(/\/$/, "");
    const withoutLocale = path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "");
    const base = target.path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "");
    return (
      withoutLocale === base ||
      ["login", "createAccount", "userHome", "activate", "verify", "verifyEmail"].some(
        (action) => withoutLocale === `${base}/${action}`,
      )
    );
  } catch {
    return false;
  }
}

export function accountVerificationInput(request, input, now = Date.now()) {
  if (
    !request ||
    !input ||
    input.recipient?.toLowerCase() !== request.email.toLowerCase() ||
    input.tenantOrigin !== request.tenantOrigin
  )
    return false;
  const received = Date.parse(input.receivedAt);
  const requested = Date.parse(request.requestedAt);
  const sender = String(input.sender ?? "")
    .toLowerCase()
    .split("@")
    .at(-1);
  if (
    !Number.isFinite(received) ||
    !Number.isFinite(requested) ||
    received < requested ||
    received > now + 60000 ||
    !request.senderDomains.some((domain) => sender === domain || sender.endsWith(`.${domain}`))
  )
    return false;
  if (typeof input.code === "string" && /^[A-Za-z0-9-]{4,32}$/.test(input.code) && !input.link)
    return true;
  if (
    typeof input.link !== "string" ||
    input.code ||
    !request.linkOrigin ||
    !request.linkPathPrefix
  )
    return false;
  try {
    const url = new URL(input.link);
    // Workday emails omit the language segment the site path may carry (/en-US/Site).
    const withoutLocale = (path) => path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "");
    const path = withoutLocale(url.pathname);
    const prefix = withoutLocale(request.linkPathPrefix);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.origin === request.linkOrigin &&
      (path === prefix || path.startsWith(`${prefix}/`))
    );
  } catch {
    return false;
  }
}
