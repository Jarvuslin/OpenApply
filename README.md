<div align="center">
<img src="apps/web/public/icon.svg" width="72" alt="OpenApply" />

# OpenApply

A personal workspace for finding roles, improving your résumé, and preparing job applications with a local agent.

[Setup](#clone-and-setup-windows) · [Current capabilities](#current-capabilities) · [Architecture](docs/architecture.md) · [MIT license](LICENSE)
</div>

## Current capabilities

- Local email/password registration and an onboarding profile with autosaved drafts.
- PDF, DOCX and TXT résumé extraction through a locally authenticated Claude Code session; manual entry is also available.
- Original résumé preservation, tailored variants, PDF export and a before/after rewrite review.
- A job board importing public Ashby and Greenhouse company feeds, with location, level and required-experience filters.
- An embedded Claude Code terminal and a persistent, headed Chromium browser in a WSL2 VM, visible through noVNC.
- A preparation-only trial that inspects a real posting and form, generates a résumé variant and records missing answers.
- Existing campaign, credential-vault, inbox and Pilot infrastructure inherited from JobPilot.

**Status: development MVP.** Fully unattended signup → email activation → application submission has not passed an independent end-to-end test. CAPTCHA solving is disabled; blocking challenges, MFA and missing facts pause the flow. Public feed availability does not guarantee that an employer form will accept automation. Claude is the tested local provider; Codex integration is inherited and its Windows launcher still needs validation. No hosted OpenApply service or OpenApply installer release is published.

## Clone and setup (Windows)

The VM configuration currently targets **Windows x64 + WSL2 + Alpine Linux**. Web/API code can run on other platforms, but the bundled VM scripts and browser MCP command require adaptation. Run the following commands in PowerShell from the repository root unless noted.

### 1. Prerequisites

Install:

- [Git](https://git-scm.com/downloads)
- [Bun](https://bun.sh/docs/installation) (tested with 1.4.2)
- [Node.js](https://nodejs.org/) 22 or newer
- [.NET SDK](https://dotnet.microsoft.com/download/dotnet/10.0) 10
- [WSL2](https://learn.microsoft.com/windows/wsl/install), enabled and working
- [Claude Code](https://code.claude.com/docs/en/setup), available as `claude` on PATH

Run `claude` once and sign in with your own account. Subscription limits and provider terms still apply. This project does not include access to any model account.

```powershell
git clone https://github.com/Jarvuslin/OpenApply.git
cd OpenApply
bun install --frozen-lockfile
.\scripts\setup-env.ps1
bun run --cwd apps/api db:generate
dotnet build apps/terminal
```

For a private repository, authenticate Git with your GitHub account before cloning. If PowerShell blocks a script, use your machine's approved script-execution process.

`setup-env.ps1` creates ignored `apps/api/.env` and `apps/web/.env.local` files, generating a unique JWT secret and 32-byte encryption master key. It **never overwrites existing configuration**. Keep the master key: replacing it makes existing encrypted credentials unreadable. It enables the local Claude résumé reader. Set `CLAUDE_BIN` in the API environment if `claude` is not discoverable on PATH.

### 2. Create the browser/database VM

Download the **x86_64 Mini Root Filesystem for Alpine 3.24** from [Alpine downloads](https://alpinelinux.org/downloads/) and verify its published checksum. Main and community repositories must be enabled for that release. Supply the downloaded `.tar.gz` path:

```powershell
.\scripts\setup-vm.ps1 -RootfsPath "$env:USERPROFILE\Downloads\alpine-minirootfs-3.24.0-x86_64.tar.gz"
```

Replace the filename with the version you downloaded. The script imports a WSL2 distribution and installs Chromium, PostgreSQL 18, Xvfb and noVNC. It refuses to replace an existing distribution. The internal distribution name remains `JobPilot-MVP` for compatibility with the browser connector; it is not the product name.

```powershell
.\scripts\start-mvp.ps1 -VmOnly
bun run --cwd apps/api db:migrate:apply
bun run --cwd apps/api db:seed
.\scripts\start-mvp.ps1
```

First start downloads the pinned Playwright MCP package inside the VM. Allow that download to complete. The local PostgreSQL instance uses port 5433; do not run another database or SSH tunnel on that port.

### 3. Open the app

- **Workspace:** http://localhost:4100/mvp
- **VM browser:** http://localhost:6080/vnc.html?autoconnect=1
- **API health:** http://localhost:4101/api/health
- **Terminal health:** http://localhost:4102/healthz

Register your own local account using email/password. Development registration does not send a verification email. Google/GitHub login buttons need separately configured app credentials; they are not required for local registration. Upload a résumé or complete the profile manually. Open the agent panel and complete any Claude sign-in/workspace prompts yourself.

In Discover, enter an Ashby or Greenhouse company board name (for example `ashby` for Ashby's own feed), import the board, filter roles and select one. Start with **Prepare trial · no submission**. Review the actual form requirements and résumé before enabling a real application.

The app currently uses the upstream internal plugin namespace, so `/jobpilot:mvp-trial` and `JOBPILOT_*` environment variables are intentional. Do not globally rename them without migrating the terminal/plugin interface.

### Gmail

The working integration currently uses the app's **Connections → Gmail** settings:

1. Create your own Google Cloud project, enable Gmail API, and configure an external OAuth consent screen with your email as a test user.
2. Create a Web OAuth client with this exact redirect URI:
   `http://localhost:4101/api/email/oauth/callback`
3. Enter its client ID/secret locally in the app, then authorize the intended Gmail account.

The app requests Gmail read/send access and stores tokens encrypted. Google testing-mode refresh tokens can expire after seven days. Connecting Gmail to ChatGPT/Codex or Claude does **not** mark this app connection as configured. Reusing provider connectors is planned, but the worker/email adapter has not been validated. Never paste Gmail passwords or OAuth secrets into an issue or commit.

### Stop and restart

```powershell
.\scripts\stop-mvp.ps1
.\scripts\start-mvp.ps1
```

Stop retains the VM database and browser profile. Logs and process records live in `.temp/mvp/`. API source changes require an API restart; terminal C# changes require rebuilding and restarting the terminal. Do not restart during an active application. For interactive development after the VM is running, stop the existing web/API/terminal processes and use `bun run dev`.

## Local security and data

This setup is for your own trusted machine: PostgreSQL uses local trust authentication; noVNC and browser debugging are loopback services without application authentication. Do not publish these ports or use this setup as a multi-user hosted deployment.

Personal data is stored in the VM database, the VM browser profile and `apps/api/storage/`. `.env*`, storage, `.temp/`, browser snapshots and logs are ignored by Git. Back up your database and encryption key together. Review generated résumé changes; the model can still make factual or editorial mistakes.

## Development checks

```powershell
bun run ci
bun run knip
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
bun run test
dotnet test -c Release
```

Release configuration avoids locking the development terminal executable on Windows. `dotnet build apps/terminal` is enough for local development; native AOT publishing additionally requires platform C++ build tools. Inherited deployment/release workflows and install scripts are not an OpenApply distribution channel.

## Project layout

| Directory | Purpose |
| --- | --- |
| `apps/web` | Next.js / React / MUI interface |
| `apps/api` | Elysia API, Prisma, PostgreSQL and encrypted storage |
| `apps/terminal` | .NET host for the local Claude/Codex terminal |
| `packages/contracts` | Shared validation schemas |
| `plugin` | Agent skills and browser MCP configuration |
| `scripts` | Local setup, start/stop and explicitly simulated test fixture |
| `docs/mvp.md` | Tested scope and remaining work |

## Attribution and license

OpenApply is a derivative of [suxrobGM/jobpilot](https://github.com/suxrobGM/jobpilot), originally created by Sukhrob Ilyosbekov. We reuse its application backend, terminal host, agent skills and other infrastructure. The original [MIT license and copyright notice](LICENSE) are preserved. Internal `jobpilot` package names, namespaces and historical documentation remain where required for compatibility or attribution. OpenApply's rebrand does not imply endorsement by the original author.
