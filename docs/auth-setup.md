# Sign-in setup

OpenApply supports email/password, Google, and GitHub accounts. These use the
existing API and PostgreSQL database. They are separate from connecting a Gmail
inbox or a Claude/Codex subscription. Signing in with Google grants identity
access only; it does not let the agent read email.

## Local configuration

Edit the ignored `apps/api/.env` on the machine running the API. For this checkout, that is `D:\Dev\OpenApply\apps\api\.env`. There is no `/app/.env` file. The setup command keeps the four empty provider fields visible. Fill in both fields for each provider you want to enable. Do not put
secrets in chat, browser code, `NEXT_PUBLIC_*` variables, or Git. Keep both
provider fields empty until you have both values.

| Provider | Server variables | Registered callback |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `http://localhost:4101/api/auth/providers/google/callback` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `http://localhost:4101/api/auth/providers/github/callback` |
| Email delivery | `RESEND_API_KEY`, `EMAIL_FROM` | None |

Keep `APP_URL=http://localhost:4100` and
`AUTH_OAUTH_REDIRECT_BASE=http://localhost:4101`. Use `localhost` consistently,
including when opening the app; mixing it with `127.0.0.1` breaks OAuth cookies.
Restart the API after changing its environment, then reload the sign-in page.
The launcher leaves already-running services alone: a second `start` is not a restart.
To restart the whole local stack, use `node scripts/openapply.mjs stop` followed
by `node scripts/openapply.mjs start` (finish any agent work first).

`GET /api/auth/options` reports which methods have credentials configured.
It never returns keys. A ready button means configuration is present, not that
the provider has accepted the credentials. The first real sign-in verifies that.

### Google

1. In [Google Cloud](https://console.cloud.google.com/), create or select your project.
2. Configure Google Auth Platform branding and audience. For personal accounts,
   use External; while testing, add the Google accounts you will use as test users.
3. Create an OAuth client with application type **Web application**.
4. Add the exact Google callback from the table as an authorized redirect URI.
   This is a server redirect flow, so JavaScript origins are not required.
5. Copy the client ID and secret into the two API environment fields.

The code requests `openid email profile`; Gmail API scopes are not needed for
sign-in. Register the separate Gmail callback only when setting up inbox access.
See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

### GitHub

1. Open [Developer settings → OAuth Apps](https://github.com/settings/developers).
2. Register an OAuth App named OpenApply Local, homepage
   `http://localhost:4100`, with the GitHub callback from the table.
3. Generate its client secret and save both values in the API environment.

Use an OAuth App, not a personal access token. The current implementation
requests `user:email` and uses a verified email address; it requests no private
repository permissions. Use separate local and production app registrations.
See [GitHub's registration guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

### Email/password and outgoing email

Local registration and login need no external key. By default, development
accounts are immediately verified. To test the verification flow, set:

```dotenv
AUTH_REQUIRE_EMAIL_VERIFICATION=true
RESEND_API_KEY=
EMAIL_FROM=OpenApply <accounts@your-verified-domain.example>
```

Create a sending-access API key in [Resend](https://resend.com/api-keys), and
verify your sending domain with the DNS records Resend supplies. Set that key
in `RESEND_API_KEY`. For an owner-only delivery test you can use
`OpenApply <onboarding@resend.dev>`; this test sender does not deliver to
arbitrary users. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).

Without a key, development emails (including password-reset links) go to the
local API log. Treat those logs as private; links are credentials. The form
now states this instead of promising inbox delivery. Production requires
a Resend key and a sender outside `resend.dev`, and always verifies new
email/password accounts. Setting the development toggle to false cannot
disable production verification.

Existing development users remain verified. Test verification with a new
account; changing the toggle does not rewrite existing profiles.

## Hosted backend

The current app already has a backend: Bun/Elysia, Prisma and PostgreSQL.
Running it locally means each installation has its own database. Provider
login alone does not synchronize those databases.

For shared accounts, deploy one web/API stack with:

- A single HTTPS public origin, e.g. `https://apply.your-domain.example`.
  Reverse proxy `/api/*` to the API and everything else to Next.js. This
  preserves the host-only session cookie used by Next's route guard.
- PostgreSQL with TLS, restricted access, backups and restore testing.
- A persistent private volume for the current filesystem résumé storage,
  backed up alongside the database. An object-storage adapter is future work;
  do not scale to independent API replicas with separate disks.
- A stable encryption master key in server secrets. Preserve it when moving
  existing data: otherwise encrypted Gmail credentials cannot be read.
- Resend, production OAuth credentials, and exact HTTPS callback URLs.

Set `APP_URL`, `AUTH_OAUTH_REDIRECT_BASE`, `CORS_ORIGINS` and the web
build argument `NEXT_PUBLIC_API_URL` to that same public origin. Set
`INTERNAL_API_URL=http://api:4101` for web server calls inside Docker.
Use `JWT_EXPIRY=15m` and a newly generated random JWT secret for a fresh
deployment. Never reuse placeholder secrets.

Claude/Codex subscriptions and browser VMs remain on users' machines. A hosted
login test does not validate the hosted-to-local companion connection; that
needs a separate acceptance test, including browser local-network permissions.
Keep `MVP_LOCAL_RUNNER=false` on a shared server; the development résumé reader
runs a host CLI and is not a hosted multi-user worker.

See [deployment preparation](../deploy/README.md). Required operator inputs:
domain/DNS access, a server or container host, a PostgreSQL connection string,
provider credentials and a sending domain. No business or enterprise API
qualification is required to register the sign-in clients described above.

## Acceptance checks

1. With no OAuth keys, login/register still work with email/password and
   unavailable provider buttons are disabled.
2. Configure Google, restart, sign in, log out and sign back in.
3. Repeat with GitHub. Existing verified accounts with the same email should
   link to the existing profile instead of creating a duplicate.
4. With local verification enabled and Resend configured, create a new test
   account, receive and consume its verification link, then test password reset.
5. Reject wrong passwords, invalid/expired OAuth state and reused reset links.
6. On the hosted origin, verify authenticated page navigation, refresh and
   logout over HTTPS before inviting users.

Until credentials and hosting are configured, live provider consent and real
email delivery remain untested.
