# Run OpenApply locally

This short guide is for a machine that is already set up. For first-time setup (WSL VM,
`.env` files, database), follow the [README](../README.md). For deeper reference, see
[development.md](development.md).

Run everything from the repository root in PowerShell.

## Start

```powershell
.\scripts\start-mvp.ps1
```

This starts the VM (browser and PostgreSQL on `:5433`), then the API, the website and the
terminal companion. It builds the website once and serves compiled pages, so it loads fast but
does **not** pick up source edits until you restart.

Open http://localhost:4100.

## Start with hot reload (while editing code)

```powershell
.\scripts\start-mvp.ps1 -Dev
```

`node scripts/openapply.mjs start --dev` does the same thing. To start only the apps when the
VM is already running, use `bun run dev`, or one app with `bun run dev:web`, `dev:api` or
`dev:terminal`.

What reloads by itself:

| You changed | What to do |
| --- | --- |
| `apps/web` | Nothing in dev mode. In normal mode, restart. |
| `apps/api` | Restart the API. |
| `apps/terminal` (C#) | Rebuild and restart the terminal. |

## Stop or restart

```powershell
.\scripts\stop-mvp.ps1
.\scripts\start-mvp.ps1
```

Stopping keeps the database and browser profile. Logs are in `.temp/mvp/`. Don't restart while
an application is being submitted.

## Ports

| Port | Service |
| --- | --- |
| 4100 | Website |
| 4101 | API (Swagger at `/swagger`) |
| 4102 | Terminal companion |
| 5433 | PostgreSQL in the VM |

Only one thing can use `5433`. Don't run the `db:tunnel` SSH tunnel while the local VM database
is up.

## Telegram

To link Telegram locally, create a development bot and add its settings to `apps/api/.env`. See
[telegram-setup.md](telegram-setup.md).

## Check health

```powershell
node scripts/openapply.mjs doctor
```
