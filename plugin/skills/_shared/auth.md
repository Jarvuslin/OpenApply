# Authentication in the local MVP

Use the persistent VM browser. Apply anonymously when the employer allows it.
When registration is required for the one approved application:

1. Read the actual employer/tenant hostname. Resolve only that exact scope using
   `jobpilot-api GET /api/credentials/resolve --query domain=<scope>`.
   On shared ATS hosts, include the employer tenant in the scope (host/tenant).
   A returned `default` scope is not an employer-specific credential.
2. Use an existing exact-scoped login when present. Never reset an existing
   account password automatically. Invalid credentials pause for the user.
3. If the signup form is available and no account exists, use contactEmail from
   the confirmed profile and generate a fresh random password of at least 24
   characters with the system crypto library. Save via POST /api/credentials
   with {scope,email,password} before submitting. Reuse that saved password
   when retrying; never generate a second account on an uncertain outcome.
   Do not log passwords, put them in shell command arguments or journal entries.
4. Fill the site's normal signup form. Record signup attempted, then verify its
   resulting page. Record completed only after an authenticated state is visible.
5. If email verification is required, invoke get-code with the expected sender
   domain, signup email and request timestamp. Gmail disconnected or ambiguous
   messages means needs_user. Never accept a code for another email/tenant.
6. SMS, MFA, unknown eligibility or blocking CAPTCHA means needs_user; preserve
   the session and let the user continue in the VM viewer.

CAPTCHA solving is disabled for this MVP. Do not invoke solve-captcha or any
external solving service. A passive widget is an observation, not automatically
an error. Only pause when the site requires a challenge to continue.

For OAuth/SSO, let the user complete the initial login in the persistent browser.
Do not enter the user's Gmail password into an employer's registration form.
