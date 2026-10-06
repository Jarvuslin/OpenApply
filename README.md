<div align="center">
<img src="apps/web/public/icon.svg" width="72" alt="OpenApply" />

# OpenApply

A workspace for finding employer roles, tailoring your résumé and applying through your own local agent. Accounts, profiles and application history live in Postgres.

[Setup](#setup) · [Mac beta](#clone-and-setup-mac-beta) · [Current capabilities](#current-capabilities) · [Architecture](docs/architecture.md) · [MIT license](LICENSE)
</div>

## Current capabilities

- Email/password accounts, optional Google and GitHub sign-in, and an onboarding profile with autosaved drafts.
- PDF, DOCX and TXT résumé extraction through your local Claude Code session, with manual entry available.
- Original résumé preservation, tailored variants, PDF export and a before/after rewrite review.
- Authenticated Discover with location, level and experience filters, multi-select and a standing application queue.
- Public employer feeds from Ashby, Greenhouse, Lever, SmartRecruiters and Workable.
- Optional HTTP discovery through your own Apify or SerpApi key. Unresolved listings stay visible but cannot be queued.
- Claude Code or Codex runs locally through the terminal companion. The persistent VM browser uses WSL2 on Windows or Lima on Mac beta.
- Gmail messages can be read by the local agent connector and uploaded to OpenApply. No OpenApply Google Cloud mail app is needed for this path.
- Required-question pre-scan before tailoring, per-job workers and questions for missing facts or uncertain fit.
- A preparation-only trial that inspects a real posting and form, generates a résumé variant and records missing answers.
- Existing campaign, credential-vault, inbox and Pilot infrastructure inherited from the upstream project.

**Status: development MVP.** The backend queue and mailbox ingest are tested, including real Postgres concurrency. Fully autonomous employer signup, email activation and application submission have not passed an independent end-to-end test. CAPTCHA solving is off by default. A blocking challenge parks that job and lets the queue continue. There is no published hosted OpenApply service or installer release.

## Setup

For the hosted-web direction, see [the local companion and subscription connection flow](docs/hosted-companion.md). Onboarding now starts with an optional agent check, followed by resume import and profile review. Claude extraction uses Haiku by default; Codex uses the selected provider's local CLI. A hosted website and signed companion installers have not been released.

For Google, GitHub, or email/password login, see [sign-in setup](docs/auth-setup.md).
Email/password works locally without provider keys. Google and GitHub buttons
become available after their OAuth credentials are configured on the API.

One codebase automatically selects the local runtime:

| Machine | Browser VM | Validation |
| --- | --- | --- |
| Windows x64 | Existing WSL2 / Alpine | Local development checks |
| Apple Silicon Mac, macOS 14+ | Lima / native ARM64 Alpine | Beta. real-device acceptance pending |
| Intel Mac, macOS 14+ | Lima / native x86-64 Alpine | Beta. separate Intel acceptance pending |

Detection runs on the local host. Connections displays the host OS, architecture
and runtime. Linux hosts and Windows ARM are not supported by this launcher.
The Mac beta is source-based. no signed/notarized application bundle is provided.

### Clone and setup (Mac beta)

Install Git, Node.js 22+, Bun, .NET SDK 10, Claude Code, and
[Lima 2+](https://lima-vm.io/docs/installation/). If you already use Homebrew,
`brew install lima` installs the VM manager. Use native ARM64 tools on Apple
Silicon. Run `claude` once and complete your own login.

```sh
git clone https://github.com/Jarvuslin/OpenApply.git
cd OpenApply
bun install --frozen-lockfile
node scripts/openapply.mjs doctor
node scripts/openapply.mjs setup
node scripts/openapply.mjs start
```

Setup generates local secrets without overwriting existing files, downloads a
checksum-pinned Alpine cloud image, creates the `openapply` Lima VM, installs
browser/database packages, applies database migrations and builds the terminal.
Initial downloads may take several minutes. If VM provisioning fails, inspect
Lima's logs before retrying. the setup command does not delete existing VMs.

Open **http://localhost:4100/mvp**. The agent and résumé extraction run on your
Mac using your Claude login. Chromium runs inside Linux. The VM does not mount
your home directory. `openapply-stage "<resume path>"` copies an explicitly
selected document to the VM for the agent's upload tool.

Keep the start terminal open. **Ctrl+C** stops the app processes. Then stop the VM:

```sh
node scripts/openapply.mjs stop
```

VM data and cookies persist. For diagnostics, use
`limactl shell openapply -- sudo cat /tmp/openapply-start.log`.
Ports 5433, 9222 and 6080 must be free before starting a stopped VM. Setup does not
connect Gmail or submit applications. Follow the Gmail instructions below.

**Mac support remains beta until the [real-device acceptance checklist](docs/mac-beta.md)
passes.** CI checks both Mac architectures' host code and configuration. it does
not boot the browser VM or prove an unattended employer application works.

### Clone and setup (Windows)

The Windows runtime uses **Windows x64 + WSL2 + Alpine Linux**. Run the following commands in PowerShell from the repository root unless noted.

### 1. Prerequisites

Install:

- [Git](https://git-scm.com/downloads)
- [Bun](https://bun.sh/docs/installation) (tested with 1.4.2)
- [Node.js](https://nodejs.org/) 22 or newer
- [.NET SDK](https://dotnet.microsoft.com/download/dotnet/10.0) 10
- [WSL2](https://learn.microsoft.com/windows/wsl/install), enabled and working
- [Claude Code](https://code.claude.com/docs/en/setup), available as `claude` on PATH

Run `claude` once and sign in with your own account. Subscription limits and provider terms still apply. This project does not include access to any model account.

After the Windows setup below, you can also use the shared commands
`node scripts/openapply.mjs start`, `doctor` and `stop`. they select WSL automatically.

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

Replace the filename with the version you downloaded. The script imports a WSL2 distribution and installs Chromium, PostgreSQL 18, Xvfb and noVNC. It refuses to replace an existing distribution. The WSL distribution is named `OpenApply-MVP`.

```powershell
.\scripts\start-mvp.ps1 -VmOnly
bun run --cwd apps/api db:migrate:apply
bun run --cwd apps/api db:seed
.\scripts\start-mvp.ps1
```

First start downloads the pinned Playwright MCP package inside the VM. Allow that download to complete. The local PostgreSQL instance uses port 5433. do not run another database or SSH tunnel on that port.

### 3. Open the app

- **Workspace:** http://localhost:4100/mvp
- **VM browser:** http://localhost:6080/vnc.html?autoconnect=1
- **API health:** http://localhost:4101/api/health
- **Terminal health:** http://localhost:4102/healthz

Register your own local account using email/password. Development registration does not send a verification email. Google/GitHub login buttons need separately configured app credentials. they are not required for local registration. Upload a résumé or complete the profile manually. Open the agent panel and complete any Claude sign-in/workspace prompts yourself.

In the workbench, choose an ATS provider and import a company board slug. For example, use Ashby with the slug `ashby`. Filter roles in Discover, select the ones you want and click **Apply to N selected**. Only resolved employer links are selectable. The queue skips duplicates and uses one standing campaign with no per-campaign cap. Start the local agent to drain that queue. A stopped agent leaves the jobs queued.

For a preview, open a role and use **Prepare trial · no submission**. This inspects the form and generates documents without submitting an application.

Agent commands use the `openapply` plugin namespace, such as `/openapply:mvp-trial`. The terminal supplies `OPENAPPLY_*` environment variables and the `openapply-api` command.

### Gmail through your agent

1. Connect Gmail in the Claude Code or Codex runtime that OpenApply starts. The account must be the intended applicant's mailbox. A connector in a separate chat does not automatically appear in this runtime.
2. For Claude Code, use `/mcp` in that local session to confirm the Gmail tools. The worker allowlist includes `mcp__gmail__*` and `mcp__codex_apps__gmail_*`. Match it to your installed connector's actual prefix. These names alone do not install or authorize a Gmail server.
3. Open **Connections** and click **Check Gmail connection**. This sends the `scan-inbox` skill to the selected agent. The Claude command is `/openapply:scan-inbox`.
4. The agent reads its mailbox identity, searches recent job mail and uploads normalized batches of up to 100 messages to `POST /api/email/messages/ingest`. The first successful upload creates the connector account. Repeated message IDs are ignored within that mailbox.
5. Verification searches pull fresh mail through the same connector. Approved replies use its send tool. OpenApply's OAuth sync and send endpoints return 409 for connector accounts.

If a legacy Google OAuth mailbox is connected, disconnect it in email settings before switching. Existing OAuth data and routes remain available. OpenApply sign-in with Google is separate from Gmail access and still needs the login credentials described in [sign-in setup](docs/auth-setup.md).

The backend ingest path is verified. Gmail access inside an embedded Claude worker still needs a live test with the installed connector and its actual tool prefix. If the runtime cannot expose Gmail tools, that part of unattended verification is blocked. Never enter your Gmail password into OpenApply.

### Discovery sources and blocked sites

Core employer imports use public ATS APIs without an applicant account. The API paces requests by host, retries 429 responses with backoff and identifies OpenApply in its user agent.

LinkedIn, Indeed, Glassdoor, ZipRecruiter, Upwork, Handshake and Wellfound are blocked for browser automation, account creation, board linking and credential storage. Subdomains and country sites are covered. Your own LinkedIn profile URL can still be filled into an employer form.

To discover jobs from LinkedIn or Indeed, opt in under **Connections → Optional job discovery**:

- **SerpApi:** supply your own API key for Google Jobs searches.
- **Apify:** supply your own token and choose an Indeed or LinkedIn jobs actor. No actor is enabled or selected by default. Choose one that works without your board cookies or session. The UI uses `query`, `location` and `maxItems` input fields. Other names can be set with `PUT /api/job-sources/connections/apify` using each actor's `queryField`, `locationField` and `limitField`.

Keys are encrypted per user. Searches run as HTTP calls on the API and may spend your provider credits. They never use the applicant's browser session. Input and output compatibility must be checked with your chosen actor. No paid actor or SerpApi account was tested in this change.

A direct allowed apply link is preferred. Otherwise the resolver probes the five ATS sources, matches title and location, and caches a successful company board. A score of at least 0.88 with no close competing match is required. Lower-confidence results say **employer page not found** and cannot be queued. Attribution stays on the listing source. Workday browser applications are in scope, but there is no generic Workday discovery adapter.

### Feature flags

- `PUBLIC_SITE_ENABLED=false` in both web and API hides the public SEO job routes. Robots disallows crawling and the sitemap lists only login. Authenticated Discover still works.
- `CAPTCHA_SOLVER_ENABLED=false` in the API disables solver calls. The entitlement hook can add a paid-plan check later. Disabled or failed solving leaves a verification question and an open browser tab.

### Stop and restart

```powershell
.\scripts\stop-mvp.ps1
.\scripts\start-mvp.ps1
```

Stop retains the VM database and browser profile. Logs and process records live in `.temp/mvp/`. Normal startup builds the website once, then serves compiled pages so navigation does not wait for development compilation. The local preview build uses `apps/web/.next-preview`, separate from the hot-reload cache. A build failure leaves the web server stopped and reports the error.

For hot reload while editing, use `node scripts/openapply.mjs start --dev` (Windows also accepts `.\scripts\start-mvp.ps1 -Dev`) or `bun run dev` after starting the VM. Stop the existing web/API/terminal processes before switching modes. In normal preview mode, restart after source changes to rebuild the website. API source changes require an API restart; terminal C# changes require rebuilding and restarting the terminal. Do not restart during an active application.

## Local security and data

This setup is for your own trusted machine: PostgreSQL uses local trust authentication. noVNC and browser debugging are loopback services without application authentication. Do not publish these ports or use this setup as a multi-user hosted deployment.

Personal data is stored in the VM database, the VM browser profile and `apps/api/storage/`. `.env*`, storage, `.temp/`, browser snapshots and logs are ignored by Git. Back up your database and encryption key together. Review generated résumé changes. the model can still make factual or editorial mistakes.

Staged application files live in `/home/pilot/openapply` inside the VM and persist
across restarts. remove them when no longer needed. Staging does not send files
to an employer.

## Development checks

```powershell
bun install --frozen-lockfile
bun run --cwd apps/api db:generate
bun run ci
bun run knip
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
bun run test
node --test scripts/runtime.test.mjs
dotnet test -c Release
```

Release configuration avoids locking the development terminal executable on Windows. `dotnet build apps/terminal` is enough for local development. native AOT publishing additionally requires platform C++ build tools. Inherited deployment/release workflows and install scripts are not an OpenApply distribution channel.

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

The discovery split and ATS request shapes were informed by [career-ops](https://github.com/career-ops-hq/career-ops), an MIT-licensed project. OpenApply keeps its own provider adapters and employer resolver.

OpenApply is a derivative of [suxrobGM/jobpilot](https://github.com/suxrobGM/jobpilot), originally created by Sukhrob Ilyosbekov. We reuse its application backend, terminal host, agent skills and other infrastructure. The original [MIT license and copyright notice](LICENSE) and historical changelog are preserved. Active packages, commands, runtime configuration and branding use OpenApply. This derivative does not imply endorsement by the original author.
