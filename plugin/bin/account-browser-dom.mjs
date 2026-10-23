export function inspectAccountDom() {
  const visible = (element) =>
    Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== "hidden";
  const inputs = [...document.querySelectorAll("input")].filter(
    (element) => visible(element) && !element.disabled && element.type !== "hidden",
  );
  const labels = (element) =>
    [element.getAttribute("aria-label"), element.placeholder, ...(element.labels ?? [])]
      .map((value) => (typeof value === "string" ? value : value?.textContent))
      .filter(Boolean)
      .join(" ")
      .trim();
  const passwords = inputs.filter((element) => element.type === "password");
  const emails = inputs.filter(
    (element) => element.type === "email" || /email address/i.test(labels(element)),
  );
  const buttons = [...document.querySelectorAll("button,a,[role=button]")]
    .filter(visible)
    .map((element) => (element.innerText || element.getAttribute("aria-label") || "").trim());
  const text = (document.querySelector('[role="dialog"]') ?? document.body)?.innerText ?? "";
  const codeInputs = inputs.filter((element) =>
    /^(?:verification|security|one.time|confirmation) code\b/i.test(labels(element)),
  );
  const application =
    inputs.some((element) => element.type === "file") ||
    /submit (?:job )?application/i.test(buttons.join(" "));
  const termsRequired =
    inputs.some(
      (element) =>
        element.type === "checkbox" &&
        !element.checked &&
        (element.required || /terms|consent|agree|privacy/i.test(labels(element))),
    ) || /by (?:clicking|selecting|continuing)[\s\S]{0,160}(?:agree|accept|consent)/i.test(text);
  let view = "unknown";
  if (application) view = "application_blocked";
  else if (
    /account (?:already )?exists|email (?:address )?(?:already|is already) (?:in use|registered)/i.test(
      text,
    )
  )
    view = "existing_account";
  else if (/invalid (?:email|password)|incorrect (?:email|password)|unable to sign in/i.test(text))
    view = "credentials_rejected";
  else if (passwords.length === 2 && emails.length === 1 && buttons.includes("Create Account"))
    view = "signup";
  else if (
    passwords.length === 1 &&
    emails.length === 1 &&
    buttons.some((value) => /^(?:Sign In|Submit|Log In)$/i.test(value))
  )
    view = "login";
  else if (
    codeInputs.length === 1 ||
    /(?:check your email|verification email|verify your email|activate your account)/i.test(text)
  )
    view = "verification";
  else if (
    buttons.some((value) => /^(?:Sign Out|Log Out)$/i.test(value)) &&
    /(?:candidate|my account|account settings|candidate home)/i.test(text)
  )
    view = "authenticated";
  const accountButtons = buttons.filter((value) =>
    /^(?:Sign In|Sign in with email|Create Account)$/i.test(value),
  );
  return {
    view,
    passwordCount: passwords.length,
    emailCount: emails.length,
    codeCount: codeInputs.length,
    accountButtons: [...new Set(accountButtons)],
    termsRequired,
    submissionAllowed: false,
  };
}

export function installAccountFence({ binding, email }) {
  const notify = window[binding];
  delete window[binding];
  if (typeof notify !== "function" || window[binding] !== undefined)
    throw Error("Account handoff unavailable");
  window.open = () => null;
  navigator.sendBeacon = () => false;
  const permit = (event) => {
    if (!event.isTrusted) return;
    const control = event.submitter ?? event.target.closest?.("button,input[type=submit]");
    const label = (control?.textContent || control?.value || "").trim();
    const visible = (element) => Boolean(element.getClientRects().length);
    const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
    const emails = [
      ...document.querySelectorAll('input[type="email"],input[aria-label="Email Address"]'),
    ].filter(visible);
    const matchingEmail =
      emails.length === 1 && emails[0].value.toLowerCase() === email.toLowerCase();
    let kind;
    if (
      label === "Create Account" &&
      passwords.length === 2 &&
      passwords[0].value &&
      passwords[0].value === passwords[1].value &&
      matchingEmail
    )
      kind = "signup";
    if (
      /^(Sign In|Submit|Log In)$/i.test(label) &&
      passwords.length === 1 &&
      passwords[0].value &&
      matchingEmail
    )
      kind = "login";
    if (
      /^(Verify|Verify Email|Verify Account|Confirm Code)$/i.test(label) &&
      passwords.length === 0
    )
      kind = "verify";
    if (kind) void notify(kind).catch(() => {});
  };
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target.closest?.("a,button,input[type=submit]");
      const text = target?.textContent ?? target?.value ?? "";
      if (/\b(?:apply|submit application|upload|resume)\b/i.test(text)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      permit(event);
    },
    true,
  );
  document.addEventListener("submit", permit, true);
}
