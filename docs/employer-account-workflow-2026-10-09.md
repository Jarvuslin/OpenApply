# Employer account workflow — 2026-10-09

The account worker now has an `account_only` entry point and durable API state. Applications
use the same account procedure and resume their original application only after the employer's
authenticated page is observed. An account-only run does not score jobs, prepare a resume,
fill application fields, or submit an application.

## Diagnosis

- The worker previously had review, score and apply modes, with no account-only executor.
- The current URL guard accepts Workday; the quoted blanket Workday rejection was not
  reproducible in that guard. Removing a host guard would not have implemented signup.
- Gmail search success establishes read access, not the authenticated mailbox identity needed
  for verification-code retrieval.
- Workday's own careers tenant shows a Create Account form without an email-only existence
  check. Requiring a site assertion of account absence deadlocked this legitimate flow.
- The active browser requires the user to enter and submit new credentials and requires
  action-time confirmation for binding terms. Changing model/provider does not remove these
  runtime requirements.

## Implemented behavior

1. Settings → Credentials → New accounts saves the user's signup email/password through the
   encrypted vault, under the explicit `signup` scope. The default credential's **Use for new
   accounts** action copies it into that scope without retyping or removing the default.
   Existing logins use exact employer scopes.
2. The worker inspects the employer tenant and existing session. Observed absence and a visible
   signup form are distinct observations: a signup form permits an explicitly authorized first
   attempt but does not prove that an account is absent.
3. The API reserves signup once and pins the supplied encrypted credential into that employer's
   scope. Restarts, competing workers and uncertain outcomes cannot issue a second reservation.
4. An existing account without a usable login creates a durable question. A duplicate-account
   response after signup does not turn the proposed signup password into a known existing login.
5. When configured, Telegram sends the user a link to OpenApply's secure password-entry form.
   Passwords are never requested in Telegram or chat. A delivery is reported sent only after a
   verified Telegram success response. Missing configuration or delivery failure keeps the
   question available in OpenApply.
6. Saving the existing password requires a signed-in human session. Credential storage, answering
   the question and resuming inspection are transactional. Skip or expiration skips the affected
   request; other jobs can continue while it waits.
7. Runtime password, terms, mailbox, CAPTCHA and verification handoffs preserve the account
   attempt and browser tab. Continue reopens inspection, not signup permission or proof of success.

The two additive employer-account and Telegram database migrations have been applied to the
development database. Telegram still requires the user's bot token and private chat ID in
Settings → Notifications.

## Validation

| Check | Result |
| --- | --- |
| Biome CI | Passed; 1,184 files checked |
| knip | Passed |
| API typecheck | Passed |
| Web typecheck | Passed |
| API tests | 1,115 passed; 0 failed |
| Contract tests | 55 passed; 0 failed |
| .NET tests | 382 passed; 0 failed |
| Web tests | 186 passed; 0 failed |

The final signup-form change was followed by API and contract tests, API and web typechecks,
Biome and knip. Web and .NET tests passed earlier in the same task; their code did not change
after those runs.

Coverage includes user/tenant ownership, single signup reservation, password pinning, secure
existing-password recovery, human-session handoff enforcement, skip/expiry, question creation
and answer transactions, stale context rejection, account-only context detachment, and mocked
Telegram success/failure/ambiguous delivery without duplicate sends. These tests are not evidence
of a successful signup at a real employer or a live Telegram delivery.

## Live trial status

Selected Workday's own tenant through its official careers page:
<https://workday.wd5.myworkdayjobs.com/Workday>.

The live browser reached Sign In → Sign in with email → Create Account. The form requires email,
password and password confirmation, plus agreement to create the account. Password rules require
at least eight characters with lower/upper case, a number and a special character. The page links
Workday's Recruitment Privacy Statement.

At the user's direction, the existing default credential was copied into New accounts through the
visible UI; the original default is retained. OpenApply's normal companion was connected and one
fresh Claude account-only trial was launched through its signed-in chat UI. Process metadata
confirmed it loaded the current repository plugin files without a resumed session.

The worker created attempt `febbe2be-830e-4f20-81a3-a92cb5fb4d2a`, observed the actual signup form,
reserved signup once at `2026-10-09T05:40:20Z`, and read back `needs_user/password_entry`.
Question `8b434de2-9d6c-4707-8b4c-345b29d9114e` is saved and expires at `2026-10-10T05:40Z`.
This is live evidence that worker dispatch, the account API, signup reservation, persisted handoff
and in-app question presentation work together. The empty signup form was independently visible
in the worker's live browser viewer.

No password was entered into Workday, no signup was submitted, no account was confirmed and no
application was started. The user must complete new-password entry, confirmation and submission
in that preserved browser, then use the secure request's Continue action. The worker must inspect
the resulting employer page before recording authentication or proceeding to verification.
Telegram returned `telegram_not_configured`; no live Telegram alert was sent.

- Trial chat: <http://localhost:4100/chat?thread=54a14698-bb39-43f0-88c2-cb9c92c59a7a>
- Secure request: <http://localhost:4100/settings/credentials?accountAttempt=febbe2be-830e-4f20-81a3-a92cb5fb4d2a>
- Preserved worker browser: <http://localhost:6080/vnc.html?autoconnect=1&resize=scale>
