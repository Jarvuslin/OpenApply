# How OpenApply works

OpenApply has a web interface, an API backed by Postgres, and a local terminal companion. This repository currently runs all three for development. The web and API can later be hosted while each user's agent and browser stay on their machine. There is no public hosted OpenApply deployment yet.

## Data and identity

The API owns accounts, profile facts, original resumes, variants, job listings, campaign queues, questions and application receipts. Google and GitHub login are optional alternatives to email/password. These sign-in providers do not grant Gmail access.

Credentials and discovery keys are encrypted with a key specific to each user. Auth guards scope account data to that user. The admin panel remains restricted to admins. Shared job listings contain posting information, not applicant identity.

## Discovery and application

The API imports public Ashby, Greenhouse, Lever, SmartRecruiters and Workable feeds over HTTP. Users may opt into Apify or SerpApi with their own keys. Browser sessions and board cookies are never used by these connectors.

A source keeps its attribution URL and a separate canonical apply URL. The resolver accepts direct allowed employer links or strong title-and-location matches from a nonempty ATS board. Unresolved listings remain visible but cannot be queued. Blocked board hosts are rejected by the API when approving or starting an application.

Discover selections enter a standing campaign. Duplicate URLs and previous applications are skipped. A database transaction serializes concurrent queue requests for each user. The local agent processes approved jobs sequentially and writes progress through the API.

## Local agent and mailbox

The terminal companion starts Claude Code or Codex under the user's subscription and exposes the terminal in the web app. The plugin supplies skills and a per-job worker. The host clears Pilot context between cycles. Browser cookies persist in the VM while job-specific model context stays separate.

The worker checks required eligibility questions before tailoring. Clear jobs can submit automatically. Missing facts and uncertain claims or fit become questions. A blocking CAPTCHA is parked unless the solver entitlement allows an attempt. Failed solving also parks the job.

The local Gmail connector owns its authentication. The agent reads mail and uploads normalized messages to the API. The first ingest creates an account record with provider connector. Mail IDs are unique within each mailbox. Approved replies use the connector send tool. Legacy Google OAuth mailbox routes remain, but a user must disconnect that mailbox before switching to connector ingest.

## Runtime and deployment limits

Windows uses WSL2 and Mac beta uses Lima for the browser VM. The API and document tools run on the host in the local setup. Files are explicitly staged into the VM before browser upload.

The local database, noVNC and debugging ports are development services. Do not expose them as a hosted product. Production hosting, cross-instance event delivery, operational backups and deployment acceptance are separate work. See [MVP evidence](mvp.md), [setup](../README.md) and [development reference](development.md).
