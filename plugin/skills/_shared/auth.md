# Authentication in the local MVP

Use the persistent VM browser. Apply anonymously when the employer allows it.
When registration is required for the one approved application:

1. Read the actual employer/tenant hostname. Resolve only that exact scope using
   `jobpilot-api GET /api/credentials/resolve --query domain=<scope>`.
   On shared ATS hosts, include the employer tenant in the scope (host/tenant).
   A returned `default` scope is not an employer-specific credential.
2. Use an existing exact-scoped login when present. Never reset an existing
   account password automatically. Invalid credentials return `needs_user`, category `verification`, with the tab left open.
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
6. SMS, MFA or unknown eligibility means needs_user. Preserve
   the session and let the user continue in the VM viewer.

On a blocking CAPTCHA, call `jobpilot-api GET /api/captcha/status`. Invoke `solve-captcha` only when `entitled:true`. Otherwise, or if solving fails, return `needs_user` with `category:"verification"`, leave that tab open, and let the orchestrator park this job and continue to the next. Never silently skip a challenge, change browser identity, or use proxies to evade it. A passive widget alone is not a blocking challenge.

For OAuth/SSO, let the user complete the initial login in the persistent browser.
Do not enter the user's Gmail password into an employer's registration form.
