# OpenApply MVP

Use the [README](../README.md) for installation on Windows and Mac beta. This page separates implemented behavior from live integration evidence.

## Implemented and checked in this branch

| Area | Evidence |
| --- | --- |
| Product scope | Retired routes, UI and skills removed. Auth, accounts, Postgres and admin remain. Tests reject the retired campaign source and prevent old Pilot configuration from restoring removed agenda kinds. |
| Public job site | Disabled by default. Public API routes return 404 while authenticated Discover remains available. |
| CAPTCHA | Status and solve entitlement tests pass. Disabled solving returns 403. Worker instructions park verification and continue. |
| Board restrictions | Tests cover blocked hosts, country sites, lookalikes, campaign inputs, job approval and applying, board links and credentials. |
| Public ATS imports | Fixture tests cover Ashby, Greenhouse, Lever, SmartRecruiters pagination and Workable. Existing Ashby and Greenhouse live imports predate this change. |
| Resolver | Tests check confidence, ambiguous matches, direct links and empty boards. Only allowed employer links enter the queue. |
| Application queue | Multi-slug input, duplicates and blocked-only listings are tested. A local Postgres smoke test sent concurrent batches and verified one standing campaign and no duplicate jobs. |
| Agent mailbox | Tests cover first ingest, repeat message IDs, OAuth conflicts, connector sync and send refusals. A Postgres smoke test also verified that the same provider ID can exist in separate mailboxes. |
| Browser UI | A disposable local account signed in and loaded Discover selection controls and the Connections panel. No application or connector was started. |
| Database | Both new migrations applied on local Postgres. Retired feature tables and columns remain. Synthetic smoke-test records were removed. |
| Repository checks | Frozen install, Prisma generation, Biome CI, knip, API and web typechecks, and API, contracts and web tests pass before each section commit. |

## Existing local evidence

Onboarding draft autosave, PDF/DOCX/TXT extraction, generated PDFs and rewrite comparison were exercised in earlier MVP work. The embedded Claude session inspected real forms through the VM and journaled preparation outcomes. A prior rewrite completed without corrective follow-ups, but its quality was mixed and the suggestion remained unaccepted.

An earlier operator-assisted employer account test is not proof of autonomous signup. No real application was submitted while making this branch.

## Not yet verified

- A full unattended employer signup, email activation, sign-in and application receipt using only the embedded agent.
- The actual Gmail MCP tool prefix and Gmail tool access inside a fresh Claude job-worker. Confirm with /mcp in that session. The Codex chat's available connector is not proof of Claude Code access.
- A chosen Apify Indeed actor and LinkedIn actor, their accepted input fields and output records. None is selected by default. Live paid Apify and SerpApi requests need the user's credentials and provider credits.
- Live imports for every employer and every new ATS adapter. Fixture coverage does not prove provider availability.
- Real CAPTCHA solving with an entitled account and funded solver key. Solving remains disabled by default.
- Mac ARM64 and Intel acceptance on actual machines, and Windows Codex CLI startup across installations.
- A production hosted deployment, durable multi-instance event delivery, billing or a published installer.

## Workflow

The API is the source of truth for profile facts, resumes, questions, applications and receipts. The user's Claude Code or Codex subscription runs locally. Discover can queue 1 to 100 selected slugs per request into one uncapped standing apply campaign. Unresolved or blocked-only sources stay visible and are skipped when queued. Empty standing campaigns remain open.

One worker handles one job at a time in the shared persistent browser. It reads required eligibility questions before generating documents. A known mismatch is skipped with a reason. Missing required facts park the job before tailoring. If later questions are hidden behind an upload step, the worker checks them when they become visible.

Clear applications submit without a routine review gate. A guessed required answer, an untraceable factual claim, a score within 10 points of the minimum, or a deliberate verdict with open gaps triggers review. Blocking verification leaves the tab open and parks the job. Never invent candidate facts or report success without a visible employer receipt.

Gmail authentication belongs to the local agent connector. The agent uploads normalized messages to the authenticated ingest endpoint. Readiness recognizes the stored connector account, while lastSyncAt records its most recent upload. Neither proves that a future connector call will succeed. Sending happens through the connector after reply approval.

The local simulated fixture proves only fixture behavior. Do not describe it as a real Gmail, CAPTCHA or employer submission test.
