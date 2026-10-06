# Hosting preparation

The hosted half of OpenApply: the web app and API run as containers behind
nginx; PostgreSQL is external. Users run the agent and terminal companion on
their own machines, so nothing agent-related is deployed here.

No hosted OpenApply deployment is currently provisioned or verified. Required
inputs: a domain and DNS access, Linux server with Docker Compose and nginx,
TLS certificate, PostgreSQL connection string, OAuth clients, and a Resend key
with a verified sending domain. See [auth setup](../docs/auth-setup.md).
Keep `MVP_LOCAL_RUNNER=false` on a shared server; the development résumé reader
runs the server owner's CLI and is not a hosted multi-user worker.

## Build this fork from source

Run from this directory on the target host:

```sh
cp .env.example .env
chmod 600 .env
# Edit .env with your actual URLs and secrets before continuing.
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml run --rm --no-deps api bun run db:migrate:apply
docker compose -f docker-compose.yml -f docker-compose.build.yml run --rm --no-deps api bun run db:seed
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --no-build
docker compose ps
```

The source override builds local images; a published GHCR release is not required.
`GITHUB_REPOSITORY=jarvuslin/openapply` is their image-name namespace.
The base compose file alone expects published images.

`NEXT_PUBLIC_API_URL` is baked into the web build from `APP_URL`.
Rebuild when the public origin changes. Set `APP_URL`, `CORS_ORIGINS` and
`AUTH_OAUTH_REDIRECT_BASE` to the same HTTPS public origin. Next's route guard
and the API need the same host-only session cookie. Replace the example domain
in `openapply.conf` and enable TLS before login.
The production API rejects HTTP auth origins, split web/API callback origins,
missing mail delivery, test email senders, and obvious JWT placeholder secrets.
The Google/GitHub callbacks are `https://YOUR_DOMAIN/api/auth/providers/google/callback`
and `https://YOUR_DOMAIN/api/auth/providers/github/callback`.

## Data and acceptance

Use PostgreSQL TLS according to your provider's instructions and restrict database
access. Back up PostgreSQL and the private `api-storage` volume; do not use
`docker compose down -v` on a data-bearing deployment. Multiple API replicas
with independent disks are unsupported until a shared storage adapter is added.

Moving an existing local profile requires a tested database dump/restore plus
résumé-file copy. Preserve `SECRET_MASTER_KEY` to read encrypted credentials.
Audit/reverify development accounts whose email ownership was never checked
before opening the server to other people. This change does not migrate data.

Health checks do not prove OAuth, email delivery or the HTTPS-to-local-companion
connection. Complete the auth guide's acceptance checks and a local-agent test
(including browser local-network permissions) before inviting users.

## Pieces

- [docker-compose.yml](docker-compose.yml) pulls `api` and `web` images from
  GHCR (tagged `latest` by the release workflow). The API keeps uploaded files
  in the `api-storage` volume and both services expose health checks, bound to
  localhost only.
- [openapply.conf](openapply.conf) is the nginx site config: one origin, web at
  `/`, API proxied at `/api` with SSE buffering off. Install steps are in the
  file's header comment; TLS comes from `certbot --nginx`.
- `.env` (not committed) holds `DATABASE_URL` for the external PostgreSQL,
  `GITHUB_REPOSITORY` (lowercased `owner/repo`, written by the deploy
  workflow), and optional `API_PORT` / `WEB_PORT` overrides.

## Update using published images

```bash
docker compose pull
docker compose up -d
```

Health checks gate the web container on a healthy API, so a broken API image
stops the rollout by itself. Check status with `docker compose ps`; the API
answers on `/api/health`.
