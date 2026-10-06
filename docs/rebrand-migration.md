# OpenApply naming and local data

Active code uses `@openapply/*` packages, `OpenApply.Terminal`, the `openapply`
plugin, `openapply-api`, `OPENAPPLY_*` variables and the `openapply://` protocol.
Windows uses the `OpenApply-MVP` WSL distribution. Mac uses the `openapply` Lima
instance. Installers and updates download releases from `Jarvuslin/OpenApply`.
The upstream license, attribution and historical changelog remain intact.

## This local installation

- Source and independent Git history: `D:\Dev\OpenApply`.
- Browser VM: `D:\Dev\OpenApply-vm`.
- Recovery export, résumé storage and API environment backup: `D:\Dev\OpenApply-backups`.
- Development tools: `D:\Dev\tools`, added to the user PATH.
- API environment: `D:\Dev\OpenApply\apps\api\.env`.

The database was already a local PostgreSQL 18 instance on port 5433. It was
renamed to `openapply` with its existing tables and accounts preserved. It is
not connected to the upstream author's database. The development connection is:

```dotenv
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/openapply
```

This is a local VM connection with loopback trust authentication. A hosted
deployment needs its own secured PostgreSQL URL, backups and persistent storage.
Keep the API encryption master key with any database backup. It was not rotated
during this move.

Old source leftovers and the stopped original WSL distribution are retained as
recovery copies. Run the app only from the new folder and new distribution.
Do not start both VM copies on port 5433.

## Browser and agent state

The web app migrates saved onboarding drafts and agent preferences to the new
storage keys. It does not overwrite newer drafts. Authentication cookies and
database profiles keep their existing values.

Start a fresh agent session after upgrading so it receives the new command and
environment names. The VM browser profile was copied with the distribution.
The terminal scratch cleaner now skips filesystem links instead of following
them outside its scratch directories. Keep permanent backups outside `.temp`.

## Sign-in providers

The four Google and GitHub fields are already present in `apps/api/.env`.
Fill in both values for each provider, then restart the API. Do not put secrets
in `apps/web/.env.local`. See [sign-in setup](auth-setup.md) for exact callbacks
and registration steps. Google sign-in does not grant Gmail mailbox access.
