# Authentication in the local MVP

Use the persistent VM browser. Apply anonymously when the employer allows it.
When registration is required within the user's authorized application scope:

1. The user has one job login for every employer site. Never read it or type it yourself: the
   password must not enter your context. Open the site's sign-in form (not the create-account
   form), then run `openapply-login`. It fills the saved login into the visible form, submits it
   and prints `{signedIn, message, url}` or `{signedIn:false, reason}`. `reason:"no_saved_login"`
   means no login is saved: return `needs_user` asking the user to save their job login on the
   Queue page.
2. Check for an existing authenticated session first. If `openapply-login` returns
   `signedIn:false` with a message saying the account doesn't exist, or a wrong email/password
   message on a site where this login never had an account, treat it as no account (step 3).
   Any other failure returns `needs_user` with the site's exact message. Never reset a
   password, switch to another email/alias or create a second account.
3. When the site reports no account for this email and signup is needed, do not sign up from an
   application worker. Ask the queue to create the account:
   `openapply-api POST /api/work-queue/$OPENAPPLY_WORK_ITEM_ID/account-setup --data
   '{"signupUrl":"<exact signup page URL>","tenantOrigin":"<https://employer-host>"}'`.
   If it returns phase `authenticated`, the account already exists: sign in and continue.
   Otherwise return `needs_user`, category `verification`, reason `Creating your account on
   <host>`, and leave the tab open. The account worker signs up with the job login, accepts the
   employer's signup terms, reads the verification email, and the queue resumes this job by
   itself once the account exists.
4. Do not log passwords, put them in shell command arguments or journal entries.
5. If email verification is required, invoke get-code with the expected sender
   domain, employer tenant, signup email, request timestamp and any explicit user
   confirmation of the mailbox connected to this runtime. When the connector lacks
   a profile lookup, get-code may use that confirmation for this narrow read; never
   call it provider-verified or override a known profile mismatch. Gmail disconnected or ambiguous
   messages means needs_user. Never accept a code for another email/tenant.
6. SMS, MFA or unknown eligibility means needs_user. Preserve
   the session and let the user continue in the VM viewer.

On a blocking CAPTCHA, call `openapply-api GET /api/captcha/status`. Invoke `solve-captcha` only when `entitled:true`. Otherwise, or if solving fails, return `needs_user` with `category:"verification"`, leave that tab open, and let the orchestrator park this job and continue to the next. Never silently skip a challenge, change browser identity, or use proxies to evade it. A passive widget alone is not a blocking challenge.

For OAuth/SSO, let the user complete the initial login in the persistent browser.
Do not enter the user's Gmail password into an employer's registration form.
