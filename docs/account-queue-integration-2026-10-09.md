# Account queue integration — 2026-10-09

Status: this is the frozen pre-activation report. Normal-app activation subsequently completed; see [the activation report](account-queue-activation-2026-10-09.md) for current status and remaining live-trial blockers. The implementation and test evidence below is retained as recorded at staging. This report supersedes the implementation-gap sections of `workday-account-setup-2026-10-09.md`.

## Authoritative sources and preserved work

The normal checkout is `D:/Dev/OpenApply` on `codex/apply-pipeline`. The implementation checkout is `C:/Users/7474g/.codex/worktrees/apply-pipeline-queue/OpenApply` on `codex/apply-pipeline-queue`. Both initially had HEAD `18433567acd483a84ce321fcff29a0d13dc8799f` and extensive uncommitted changes.

The implementation checkout contains the common queue, execution grants, preparation, Needs-you, and account executor. The normal checkout's standalone employer-account and old Telegram implementations were audited against it. Their account history is preserved by migration, while the common queue replaces their active execution paths. Existing branding assets and historical documentation were retained. Credential settings retain New accounts and Update actions, using metadata-only reads and direct secret saves.

Original source snapshots, binary diffs, comparison/audit records, and a conflict-detecting integration helper are under `D:/Dev/OpenApply/.temp/account-integration-20261009/`. The helper excludes secrets, dependencies, generated output and local storage. It refuses concurrent destination edits, changed staging bytes, unsafe paths, and repeated application. No commit or push was made.

Final staging detected that 1,453 of the 1,583 sealed original backup files had disappeared; the remaining 130 still matched. All 1,583 current normal-checkout files matched the sealed hashes exactly. The old backup was preserved and a new immutable snapshot was reconstructed from those verified bytes, with before/after hash checks. The v2 helper retains all conflict guards and points to `D:/Dev/OpenApply-integration-backups/20261009-account-queue/source-backup-normal-v2`. The baseline inventory and hashes are unchanged. Durable audit/staging copies are stored beside that backup, outside the companion's `.temp` cleanup tree. The cleanup service's 24-hour timestamp policy is a plausible cause of the missing old files; no deletion log establishes causation.

## Implemented

- An account-only v2 snapshot, revision/hash-bound execution grant, scoped API token and runtime dispatch use the common queue. Account work has no job, campaign, application or resume scope.
- A durable begin consumes the single signup attempt before browser mutation. Unknown results remain unresolved. New enqueue keys, old legacy attempts, invalid continuation revisions, and consumed grants cannot replay signup.
- Recovery separates human-saved existing-account login from new-account defaults. Needs-you links to the exact account item and secure credential controls; passwords are not generic question answers, chat messages or Telegram content.
- Credential list/selection responses expose only metadata. Passwords stay outside snapshots, events and model prompts; existing login credentials travel through the trusted host-to-browser channel. Credential saves avoid mutation-cache retention and automatic retry.
- The dedicated browser exposes only account inspect, preparation, existing login, verification and help operations. It exposes no general click, navigation, shell, upload or CDP interface. A network fence blocks application writes, off-tenant actions and unrecognized writes, including during human handoff. Account routes bind the exact tenant/site; static assets are separately restricted.
- Signup is automated. The `signup` operation fills the saved signup password, accepts required terms and submits; the broker's own submit (or a parked human's) permits one signup request, and the attempt is persisted before transmission. A parked browser remains bounded to 15 minutes and retains application fences.
- Verification lookup is request-scoped: confirmed recipient, expected sender, tenant and request timestamp; at most one metadata Gmail query and three eligible message reads. Mismatch or authorization failure stops the flow. Actual authentication evidence, not the model's completion text, determines success.
- The account worker uses the existing Claude subscription and connector. Preflight rejects API-key/provider overrides. The installed Claude CLI suppresses its cloud Gmail connector under `--strict-mcp-config`; the account launch instead excludes normal settings sources, admits only the account broker and Gmail server, and enforces exact tool hooks. Managed restrictions retain precedence.
- Existing-account recovery can generate the configured Telegram outbox notification directing the user to secure settings. Telegram was not configured in the normal database, and no live notification was sent in this work.

## Database integration

The normal database initially contained 62 applied migrations and no common-queue tables. Its two already-applied October 9 employer-account/Telegram migrations are retained byte for byte. Ten additional migrations are required:

1. `20261008200000_common_work_queue`
2. `20261008210000_application_questions`
3. `20261008220000_confirmed_answer_bank`
4. `20261008230000_application_preparation`
5. `20261009000000_account_setup_intent`
6. `20261009000000_shadow_scoring`
7. `20261010000000_controlled_concurrency`
8. `20261010120000_archive_legacy_telegram`
9. `20261011000000_telegram_channel`
10. `20261012010000_account_setup_recovery`

The archive preserves old encrypted Telegram settings and delivery history; it does not enable a new pairing or delivery. Recovery migrates legacy/begun account attempts into inspect-only Needs-you items and preserves consumed execution markers. A permanent legacy-identity guard prevents replay even if the imported queue item is later removed. Unstarted v1 items receive new v2 snapshots; inconsistent historical attempt data fails closed.

A fresh disposable database rehearsal applied the 62-migration normal baseline and all ten additions. Real parsers validated four migrated account snapshots/hashes. Sentinel ciphertext hashes, legacy delivery statuses, consumed execution markers, owner isolation and replay blocking passed. Evidence: `.temp/account-migration-regression/account-bridge-20261009-b/report.json`.

One historical applied checksum differs from its current source because an earlier change renamed JobPilot to OpenApply in a SQL comment. The executable SQL and resulting columns/indexes/foreign keys were checked; no migration history checksum was rewritten.

The user explicitly approved backup, the ten non-throwaway normal-database migrations, and coordinated activation. At this staging checkpoint no normal migration, source activation, or coordinated service restart has occurred.

## Tested

| Check | Evidence |
| --- | --- |
| API suite | 1,487 passed, 5,241 assertions |
| Contracts | 53 passed, 202 assertions |
| Web tests | 344 passed, 932 assertions |
| Terminal tests | Final `dotnet test`: 477 passed, 0 failed/skipped; earlier direct assembly run also passed 477 |
| Node local test inventory | 214 passed |
| Real Chromium synthetic account fixtures | 7 passed |
| Migration recovery rehearsal | Passed on a fresh disposable database |
| Final Biome CI, Knip, API/web type checks | Passed after the production-build route repairs |
| Production web build | Passed after Next/MUI link and route Suspense repairs; all 67 pages generated |

The final `dotnet test` invocation executed all 477 terminal tests and passed. Earlier verification used the compiled xUnit assembly directly when the initial invocation reported no tests; the final evidence is `.temp/account-browser-preflight/final-dotnet-test.log`.

The browser fixtures cover manual signup exactly once, fresh verification/authentication evidence, application controls and requests blocked, terms handoff, existing-login credential purpose, static-asset redirects and denied application redirects. A subsequent regression tightened the tenant component of account paths and passed.

## Activated and live-verified

**Activated in the normal app: no at this staging checkpoint.** Coordinated activation is approved and prepared. Web, API and companion must be activated together; a worktree-only build is not product completion.

**Rendered disposable preview: passed.** CUA inspection verified Queue connected to the isolated companion with a zero model budget and zero workers; Needs-you linking to the exact account item; consumed-attempt account detail with no-replay/manual-inspection recovery; account creation using metadata-only credential selection and explicit mailbox confirmation; and Credentials with Update and New accounts/Login/Captcha-service controls. No real password was entered. A read-only audit found no new executions, active leases, work events, chat runs, Telegram delivery or pairing. The inherited consumed execution stayed unchanged.

The isolated companion health and readiness checks passed with zero model requests, grants and provider launches. Its protected model/provider entrypoints returned 403. Companion cleanup confirmed no owned processes or port 14102 listener. A later independent observation found no remaining preview processes or listeners on 14100, 14101, 14102 or 15433; the original preview-ready report was preserved because its supervisor did not record final cleanup. Disposable fixture databases were retained. Evidence is under `.temp/account-companion-preflight-20261009/` and the normal checkout's `.temp/account-integration-20261009/preview-75eca2363242/`.

**Public Workday browser preflight: passed, read-only.** The isolated account browser rendered a real Workday Create Account page. It entered no email/password, called no model, consumed no account begin, and sent no signup or application request. This verifies page/assets compatibility, not account creation.

**Actual account creation, worker Gmail message reading and fresh-code acceptance: unverified.** The earlier direct Gmail diagnostic searched successfully in three model requests and found no matching mail. It cannot establish queued-worker access or signup success. A later model-free CLI connector metadata check reported Connected; it did not search or read mail.

The previously begun legacy Workday attempt remains consumed and cannot be replayed. No live account trial was launched or repeated during this integration work. No separate paid API credentials or provider changes were used. Passwords, verification codes and mail bodies are excluded from this report.

## Scope of subsequent full-application trials

The user subsequently authorized Workday and Ashby end-to-end application trials, ignoring match quality for this test. Those trials have not been run at this checkpoint. Account-browser success does not imply full Workday application support: the ordinary application browser still rejects Workday. An independent audit also found that the queued fallback worker stages the PDF outside the browser MCP upload root, so its resume dropzone upload can be denied. Native preparation uses a Buffer-based upload and is a separate path. These full-application gaps require a focused fix and synthetic upload validation before a live submission; they are not silently included in this tested account-product integration.
