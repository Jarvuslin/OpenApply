# Queue and account workflow verification — October 8, 2026

## Approach and scope

Verify the current common queue in an isolated environment before consuming Claude. Keep application execution evidence separate from infrastructure/UI checks and from browser-assisted external account creation. Use one synthetic application allocation, no automatic model retry, no real employer application, and no production database migration.

The user requested manual queue admission/execution, automatic admission, and real Workday account creation with Gmail verification. They authorized any Workday site; Alcoa's official Workday careers site was selected. The user selected a mailbox, and its authenticated Gmail profile matched that selection in this Codex chat. No account has been created or email sent.

## Checklist

- [x] Inspect current queue, scheduler, fixture and mailbox implementations.
- [x] Identify the currently running checkout versus the implemented worktree.
- [x] Inspect a real Workday signup page without submitting user data.
- [x] Fix and regress excluded-job scheduler starvation without a model.
- [x] Verify disposable infrastructure, manual and automatic admission.
- [x] Prepare a one-use, exact-work-item application test through QueueRuntime.
- [x] Execute one live synthetic application after deterministic preflight; preserve its failed overall acceptance result.
- [x] Verify the user-selected Gmail identity and limited search access in this Codex chat.
- [ ] Verify worker mailbox access and complete the permitted Workday account flow.
- [x] Preserve results, usage counters and cleanup evidence; report incomplete paths honestly.

## Findings before execution

| Path | Actual state | Consequence |
| --- | --- | --- |
| Current running web app | Runs the original `D:/Dev/OpenApply` checkout, while queue implementation is in the managed C: worktree | Test current implementation on isolated ports; do not mutate or migrate the normal app |
| Manual saved-job admission | Common queue and bounded application grants exist | A prepared synthetic job can test production dispatch |
| Add URL → preparation | URL intake excludes loopback; live preparation is explicitly disabled | Saved-job execution cannot be reported as fresh-URL preparation success |
| Pilot auto-add | Scheduler admits approved/current scored jobs; due searches are separate work items | Admission can be tested deterministically; automatic discovery is not proven by admission |
| Scheduler exclusions | One excluded approved job can roll back the entire admission cycle | Narrow fix and regression required |
| Workday worker browser | Broker permits reviewed Greenhouse/Lever/Ashby URLs and explicitly enabled loopback, rejecting Workday | A separate browser signup does not prove queued Workday execution |
| Gmail worker | Observed Claude connector prefix is absent from worker grants, and standard connector lacks authenticated profile lookup | The successful Codex Gmail profile/search checks do not establish queued-worker Gmail access |
| Existing ATS fixtures | Anonymous forms only; no signup, mailbox or email-code flow | Existing fixture passes cannot be reused as account-creation proof |
| Historical E2E command | Disabled because it uses legacy Chat dispatch | Do not bypass or relaunch it |

## External account boundary

Alcoa's Workday signup page (`https://alcoa.wd5.myworkdayjobs.com/careers`) was inspected. It requires email, password, repeated password and consent to retention of name/email for employment consideration. No form values were entered. Account absence and terms acceptance must be resolved before signup; existing/ambiguous account state must not trigger another account or password reset. Verification codes and credentials must stay out of reports.

## Results

Infrastructure metadata preflight passed: the shared companion is idle, dedicated ports are available, WSL/Chromium/Playwright are installed, and the guest PostgreSQL cluster identity matches the disposable test cluster. Claude authentication metadata reports `claude.ai` / first-party / Pro, with no stored API key and no alternate-provider routing environment variables. This is not a quota probe and does not measure remaining subscription allowance.

Focused model-free checks: **53 tests passed** (45 API, 6 web, 2 URL-policy tests; 179 Bun assertions), plus two direct assertions confirming that current browser policy rejects Workday. No real mailbox or provider was contacted by these tests. Evidence: `.temp/full-workflow-20261008/gmail-preflight.json`.

Scheduler starvation was reproduced before the fix (8 tests passed, 5 failed), then corrected by checking active owned company exclusions inside the existing user lock before automatic admission. The normal enqueue guard and unrelated failure propagation remain intact. Afterward, 23 focused tests / 122 assertions, API typecheck and scoped Biome passed. Evidence: `.temp/full-workflow-20261008/scheduler-fix.md`.

The fresh disposable database `apply_e2e_fba7e62e5f51` passed all 14 verification groups, including concurrent manual admission/deduplication, ownership, leases, ambiguous-attempt recovery and three automatic-admission groups. Automatic admission created three WorkItems and zero WorkExecutions, Applications or SubmissionAttempts. It made zero external requests. Saved-search admission is explicitly not discovery execution. Evidence: `.temp/queue-regression/full-workflow-queue-20261008-a/database-checks.json`.

The first UI pass failed at an obsolete heading locator, while its saved screenshot showed the activity panel rendered correctly. Updated `scripts/queue-regression/observe-ui.mjs` to locate the actual section title. Replayed **only UI** against a fresh clone, with no migration, reseeding, scheduler rerun or model: **8 checks passed**, including activity, pause/resume/stop and stop persistence. Original source database fingerprints remained unchanged; cleanup passed. Evidence: `.temp/queue-regression/full-workflow-queue-ui-20261008-a/report.json`. The original failure report is preserved.

The .NET Gmail suite was initially deferred; it was subsequently covered by the complete terminal test run required for the runtime correction below. The earlier guest browser-host test was not counted because it launches Chromium rather than exercising only the URL policy.

The full API unit suite passed **1,449 tests / 4,917 assertions** across 195 files. Focused API results above overlap this count. Biome and Knip passed; their informational suggestions were not applied. These checks made no model calls.

## One live common-queue application

Run `35189e22-2161-471b-b6e3-64156fa2fee8` used a fresh verified disposable database (`apply_e2e_fe6fff58e92e`), one exact-work-item approval and one synthetic Greenhouse case. The real Claude worker filled the browser form, uploaded the selected immutable resume PDF, submitted exactly once, captured the fixture receipt and recorded the application through the production API. The WorkItem reached `submitted`, the SubmissionAttempt reached `recorded`, and the fixture recorded exactly one POST and one application across all cases.

The preserved report remains **failed**: **49/50** original case assertions passed; the missing assertion is actual worker-handback revalidation. **6/7** aggregate assertions passed; campaign completion was withheld because that handback was missing. Final usage metadata was incomplete. Receipt and resume-evidence requirements were not removed or replaced. The successful application was not replayed.

| Evidence | Value |
| --- | --- |
| WorkItem | `e788772c-1f91-4819-9069-eb0aee80df65` |
| Execution | `87a3d4a0-b0e9-40d3-8d86-de3891dbca51` |
| Application | `85d94938-ee1c-4d5a-9bd6-f97d723d196b` |
| Receipt | `fixture-greenhouse-98451c3b-7e7b-4b4e-99eb-f611b21e3f48` |
| Submitted PDF SHA-256 | `8ee51d3fc627c0833e307a0de3d5fdacbada05c144504a3540e51e97f71a8e8e` |
| Report | `.temp/queue-apply-regression/35189e22-2161-471b-b6e3-64156fa2fee8/report.json` |
| Retained usage | Same run directory, `retained-usage/` |

Preparation was intentionally model-free: preserved synthetic scoring judgments were checked against current source/criteria, a grounded one-word resume edit went through the production compiler, and real Chromium observed the fixture's conditional form fields. This did **not** exercise new model scoring, tailoring, independent review or humanization; those unavailable review steps are explicitly recorded. It also did not exercise fresh URL intake, job discovery, Workday or Gmail. The worker's final handback was observed only in transit; the harness never manufactured one.

An earlier setup-only attempt (`a2ef9abc-e69b-459c-8612-11378436c316`) stopped on an exact DOM label mismatch before launching a companion/provider. It made zero model calls and zero submissions. The label was fixed and tested with real Chromium before the single live attempt. Both reports are retained.

### Measured partial usage

| Counter | Observed value |
| --- | ---: |
| Actual model | `claude-sonnet-5-5` |
| Requests | 24 |
| Input tokens | 48 |
| Cache-write tokens | 76,246 |
| Cache-read tokens | 840,078 |
| Output tokens | 431 |
| Total token occurrences | 916,803 |
| Subagent starts | 1 |
| Observed execution duration | 82,367 ms |
| Automatic model retries | 0 |

The ledger ended with `process_exception`, `interrupted`, and `partial_observed`. These are incomplete observed counters, **not** exact total consumption, billable-token totals, or a measurement of remaining Pro quota. Final provider totals and list-equivalent cost are unavailable. Authentication metadata identified the existing Claude Pro subscription; no API credits or alternate provider were used. No Gmail tool calls appeared in captured worker events. The private test staging denied Gmail tool names; this is not operating-system network isolation or evidence of real mailbox access.

### Completion race and correction

`WorkQueueService.refresh` reflected the durable application as `submitted` and cleared its lease while the provider was still returning the worker's result. Subsequent runtime event publication failed with HTTP 409, propagating as `process_exception`; heartbeat lease rejection could also cancel the process. Separately, the harness ended polling on API `submitted` and began cleanup without waiting for the exact worker to finish. The event rejection is the concrete observed immediate failure; cleanup was an additional race, not evidence that it alone caused the interruption.

The correction permits at most 30 seconds of finalization only after exact current execution ownership and canonical submitted evidence are verified. It awaits browser closure before returning from event publication, shares the same closure task across racing events/heartbeats, and preserves earlier approval/budget/stop limits. API refresh now settles the execution reservation in the same transaction as canonical submission; that settlement does not assert a successful model handback. The harness waits for the exact worker to drain and requires its actual handback, clean runtime status, current canonical ownership, and complete matching Sonnet usage. Neither path starts a new provider or retries a submission. Original evidence remains unchanged; this correction has not been live-retested.

Changed production paths: `apps/terminal/Queue/QueueFinalization.cs`, `QueueRuntime.cs`, the observer DTO and ownership checks, and `apps/api/src/modules/work-queue/work-queue.service.ts` / `work-queue.read.ts`. Harness changes are in `scripts/queue-apply-regression/`; the historical full-campaign command remains disabled. Independent read-only review found no remaining material issue in the corrected finalization path.

The broader affected Node harness set passed 28 tests before final guard additions; the final targeted harness/inventory run passed 14 tests with zero skips. These are overlapping test sets, not 42 distinct tests. Contracts passed 50 tests / 183 assertions. Final Biome checked 1,539 files successfully (13 informational suggestions); Knip passed with three configuration hints. No automatic fixes were applied to unrelated code.

Final production-fix validation:

| Check | Result |
| --- | --- |
| Complete terminal suite | **458 passed**, zero failures/skips, 47.419 seconds |
| Targeted API queue finalization/read/service/concurrency | **23 passed**, 104 assertions |
| API typecheck | Passed |
| Managed Release rebuild | Passed, zero warnings/errors |
| Isolated zero-budget host startup/health | **Not executed:** automatic execution policy rejected the command before process creation, with no detailed reason |
| Post-fix live-agent acceptance | Not run; successful submission preserved without replay |

Terminal tests exercise the real 30-second cutoff, an earlier two-second approval expiry, disconnect, concurrent event/heartbeat/browser-close handling, historical/foreign ownership rejection, finish-conflict reconciliation and frame denial. Providers and API/browser responses are deterministic test doubles; these tests are not fresh live acceptance evidence. The final targeted API tests are after the fix; the 1,449-test API suite recorded above ran before this narrow correction.

The [restart-terminal skill](../.claude/skills/restart-terminal/SKILL.md) requires “Stop the running host process” and “start the new build,” followed by a health check. The intended check was isolated to port 14102 with a zero model budget, preserving the old normal app. Automatic execution policy blocked it, so restart/health verification remains incomplete. The rebuilt DLL is `.temp/full-workflow-20261008/finalization-host/openapply.dll`. Native AOT publishing was not verified because this host lacks the required toolchain. No running normal-app process was replaced.

## Remaining external workflow limitations

### Supplied signup credentials

The application worker already retains authenticated credential API access and ordinary
Playwright password-field tooling. A password field alone does not require manual entry.
Clarified `plugin/skills/_shared/auth.md` and `plugin/agents/job-worker.md` to fill an explicitly
provided signup email, password and confirmation directly when authorized and permitted by the
active runtime. Preserve the supplied values, keep passwords out of application evidence, and
treat terms, existing-account ambiguity and missing runtime capabilities as separate issues.
This does not override the desktop browser tool's credential/terms rules.

Inspection also found that `CredentialService.toLogin` trimmed decrypted passwords, silently
changing supplied credentials with significant whitespace. A regression reproduced the bug;
lookup now returns the exact decrypted value while still rejecting blank-only passwords.
Five credential-resolution tests and API typechecking passed without models, a database or any
real signup. Tests use synthetic credentials; the user's password was not stored or used.
The remaining Workday blocker is the shared preparation URL gate, not password-field tooling.
Changing only its startup allowlist would be insufficient because preparation/handoff also
assume the supported collector URL shapes; those boundaries were not loosened in this change.

Real Workday account creation and Gmail code retrieval have **not** run. The user-selected mailbox identity and limited search access were verified in this Codex chat; no Gmail message content was read, no account created, and no employer application submitted. The currently implemented worker URL policy rejects Workday, and its Gmail grants/identity lookup do not establish autonomous mailbox access. Completing an account manually through this chat would not resolve those product gaps or prove the queued flow works.

The [connect-email skill](../plugin/skills/connect-email/SKILL.md) requires: “Read the real mailbox address using the connector's authenticated profile/account tool.” Its worker-access requirement is separate from this chat's connector. The current Claude worker lacks that proof; saved settings or a successful check in Codex cannot substitute for it. The [get-code skill](../plugin/skills/get-code/SKILL.md) additionally binds the code to the signup recipient, expected sender, employer tenant and current request timestamp. No code was retrieved or invented.

### Latest limited mailbox and account checks

The live Gmail authenticated-profile lookup matched the user-selected mailbox. A focused Alcoa/Workday sender search with `in:anywhere` returned zero message IDs and no next page. These checks establish identity and search access for this Codex chat only. An empty search does not establish that no Workday account exists, and no message content was opened.

The visible Workday Sign In form requires both email and password; it offers no email-only account lookup. Account absence therefore remains unverified. No account-creation request, verification email request, verification-code retrieval, or model invocation was made during these limited checks.

Only environment-presence booleans were inspected: `OPENAPPLY_API_TOKEN` and `OPENAPPLY_TEMP` were absent. No authenticated OpenApply API call, mailbox import, or credential-vault change followed. The selected address, profile response, credentials and verification codes are not reproduced here. Existing run evidence and its failed overall acceptance result remain unchanged.

All owned processes from the live attempt were stopped; disposable evidence databases were retained. The normal app and production data were not changed, and nothing was committed or pushed.

### Unattended account-test preflight

The user subsequently requested that OpenApply's agent perform account creation without manual
intervention. Read-only checks found that the currently running companion returned HTTP 200
for health (version 2.1.38) but HTTP 404 for `/queue/status`. A deterministic call to the current
production URL predicate rejected both Alcoa's Workday careers URL and an observed Workday job
URL; its supported Greenhouse control was accepted. These checks did not open either site.

The finite queue grant supports `queue-application` and `queue-intake-prepare`, with no
account-only operation. Application instructions authorize the whole saved application;
preparation forbids signup and is disabled by the current isolation gate. The Workday browser
startup rejection occurs before the provider starts, although an attempted allocation would
already have been consumed. No approval allocation was consumed by this preflight.

Result: **blocked before dispatch**, not an observed model failure or a successful signup test.
Zero Claude calls, signup requests, mailbox calls, browser actions or automatic retries were
made during this preflight. No manual form work, tool-grant changes, provider substitution or
code changes were used to obtain a pass. Evidence is the uniquely named
`.temp/full-workflow-20261008/workday-account-preflight-*.json` report.

### October 9 account setup changes

See [account setup implementation and readiness](workday-account-setup-2026-10-09.md).
The scoped account API foundation, deterministic readiness endpoint, Gmail read-tool grants
and accurate browser-startup/model-launch boundary are implemented and tested. The rebuilt
companion passed an isolated zero-model health check and was stopped cleanly. Actual account-only
browser execution and fresh Gmail identity inside the Claude worker remain unresolved; no live
signup, verification request or model call was made. The new source migration is unapplied.

The user's subsequent clarification accepts an explicitly user-confirmed Gmail address for
verification-code retrieval when Claude has no profile tool. The `get-code` and shared mailbox
instructions now support a bounded direct connector read under that condition without bulk
import or a provider-verified identity claim. Missing profile lookup is no longer an absolute
code-retrieval blocker. Actual worker search/read access and the isolated account executor
remain untested/incomplete; see the later clarification and zero-model validation in the linked
account setup report. No live verification-code lookup was performed.
