# Account queue activation — 2026-10-09

The compatible product is running from `D:/Dev/OpenApply`. The implementation worktree is no longer the only place where the account flow exists. Live account creation and Workday/Ashby application submission remain unverified.

## Implemented and integrated

The frozen account/queue implementation was integrated into the normal checkout with before/after hashes and backups. All 2,071 staged source files matched before activation. Unrelated ignored files and environment files were preserved; no commit, push or provider change was made. The original source backup and normal database backup are outside the companion's temporary-file cleanup directory:

`D:/Dev/OpenApply-integration-backups/20261009-account-queue`

The integrated account flow has a dedicated account-only browser, durable consumed-attempt tracking, uncertain-outcome recovery, metadata-only credential selection, scoped Gmail verification controls and Needs-you recovery. Account work cannot upload resumes or submit applications. Signup is automated: the host passes the saved signup password straight to the account browser, which fills it, accepts required terms and submits once. The model never sees the password. Only a CAPTCHA or a rejected password needs the user.

The original implementation/test detail is in [the frozen integration report](account-queue-integration-2026-10-09.md).

Two additional fixes were applied to the normal checkout after activation, with original-file backups and hash checks. Queued resume staging now resolves the worker's capability and stages inside its permitted `documents` directory, so both file chooser and drag/drop uploads can access the exact reviewed bytes. Worker instructions describe the two upload controls and preserve the separate account-creation boundary. Application claim/estimate now rejects an absent or invalid question-collection version before creating an execution; it no longer spends a model call only to fail preparation with version zero. Existing incomplete-question, ownership, document, quota and no-replay checks remain.

These final additions are authoritative in `D:/Dev/OpenApply`; the implementation worktree remains frozen at its integration snapshot.

## Database and activation

The user approved backup, the ten rehearsed migrations and coordinated activation. A validated custom-format database backup was taken while the old services were stopped. All ten migrations then applied, bringing the normal database from 62 to 72 applied migrations. Hash checks preserved the five original users, four encrypted credential rows, the legacy employer-account attempt, and archived Telegram settings/deliveries. Legacy execution history was parked for inspection rather than replayed.

The normal web, API and companion started together on ports 4100, 4101 and 4102. The web is a production build. The companion is a Release .NET apphost using the installed .NET 10 runtime; native AOT could not link because the required Windows C++ linker was unavailable. No toolchain was installed and no product source was changed to accommodate that local build limitation.

Activation used a zero-request host model budget. The companion is connected to the signed-in user's Queue, idle, with zero workers and no authorized model allocations. The rendered "Model execution is disabled by the host budget" message is intentional; infrastructure activation is not authorization to start an arbitrary job.

Durable activation evidence is under `activation-20261009-122345-a5e7f49a/`, including the database dump, protected-data hashes, migration receipt, build logs and `activated-model-budget-zero.json`.

The tested upload files were also synchronized into the actual published `dist/terminal/plugin` directory with matching hashes. The API was restarted after its readiness fix, and its health and the rendered Queue were checked again. `api-readiness-fix-activated.json` records that activation. A final read-only database check still found 72 migrations and unchanged protected user, credential and legacy-attempt hashes. No further database migration was needed for these fixes.

## Tested and rendered

- The frozen verification passed API 1,487, contracts 53, web 344, terminal 477, node 214 and seven real-Chromium synthetic account tests, plus the disposable migration rehearsal.
- In the normal checkout, all 477 terminal tests passed. Production web and Release companion builds passed. Stale old Next generated route types were archived before the successful web build.
- A startup-only zero-model environment variable initially contaminated six synthetic-process tests. Its failing log is retained; the corrected test environment passed all 477. No actual Claude inference ran in either test invocation.
- Final normal-checkout API suite after the readiness fix: 1,493 passed, 5,266 assertions. Queue tests: 81 passed; six new regressions cover missing, invalid, foreign, incomplete, deleted and valid question collections. CI, Knip and API typecheck passed.
- Upload/control/inventory tests: eight passed. The installed Playwright MCP and real Chromium passed a synthetic chooser/dropzone test with exact PDF bytes/name and rendered attachment evidence; six shared/foreign/symlink path operations were rejected. This verifies the upload mechanism, not a live employer submission.
- Rendered normal-app inspection verified Queue, the connected companion, Needs-you's exact account link, consumed-attempt/no-replay account recovery, the new account form's credential/mailbox controls and manual-signup explanation, and retained New accounts/Existing employer login credential controls. No credential was decrypted or changed during inspection. No browser console errors were recorded.
- Final screenshot: `D:/Dev/OpenApply-integration-backups/20261009-account-queue/normal-queue-after-fixes.jpg`. Exact postactivation file manifests, original bytes and test logs are in the durable `postactivation-fix/` directory.

## Live verification and remaining work

No live Claude worker, signup, verification-message read or application submission was started during activation. The earlier three-request Gmail search diagnostic remains search-only evidence; queued-worker message reading and fresh verification acceptance are still unverified.

The requested full Workday and Ashby trials did not launch because preflight found product gaps, not a lack of user authorization:

- Workday application URLs, authenticated account-to-application continuation and its multi-step/custom form controls need explicit implementation and testing. The current account executor stops at the account boundary.
- Ashby URLs are supported, but the generic question collector marks scripted/conditional forms partial and does not establish reliable coverage for its upload/custom controls. A validated form adapter is needed before a meaningful common-queue submission trial.
- Match-policy bypass for this exact authorized workflow trial must be represented explicitly; no score or applicant fact may be invented to pass existing gates.

Read-only findings and proposed acceptance tests are retained in the durable `full-trial-readiness-review.md` and `full-application-gaps.md`. Proposed architecture in those documents is not implemented functionality. Passwords, verification codes and email bodies are excluded from reports and logs.
