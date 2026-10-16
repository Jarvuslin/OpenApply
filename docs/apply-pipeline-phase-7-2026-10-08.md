# Phase 7: controlled concurrency

Prepared October 8, 2026 after the Phase 6 independent deterministic gate.
Snapshot `phase6-model-free-20261008` preserves 967 files and 29 deletions at
baseline `18433567acd483a84ce321fcff29a0d13dc8799f`. No baseline or phase commit
has been made; the original checkout remains available for the user's commit.

## Approach and scope

Bound concurrency in the API and companion together. Give each application
worker its own browser process, profile, endpoint and durable lease. Shared CDP
would expose all browser contexts to every worker, so separate contexts alone
are insufficient. Preserve the existing submission protocol and release worker
capacity when work parks without making an ambiguous submission retryable.

In: persistent limits/reservations, domain pacing, worker isolation, exact-PDF
preclaim checks, bounded preparation handoff, pre-run estimates, deterministic
database/browser/UI verification. Out: model execution, quota probes, employer
applications, paid credits, normal-database migrations and automatic retries.

## Plan

- [x] Persist account policy, application reservations and domain pacing atomically.
- [x] Fence independent worker/context claims with bounded concurrency and recovery.
- [x] Verify selected PDF bytes before dispatch and retain submission ambiguity.
- [x] Isolate each local worker's browser and share finite host model budgets.
- [x] Carry scripted preparation into an owned worker without submitting.
- [x] Update worker and application skills to honor common leases and contexts.
- [x] Show limits, capacity and a pre-run estimate without invented Pro percentages.
- [x] Verify disposable migration, concurrent database races and guest isolation.
- [x] Verify rendered controls, run required checks and record remaining live gates.

## Acceptance boundaries

Fake provider processes and synthetic forms can prove scheduling, isolation,
caps, readback and recovery. They cannot prove a model-backed application.
Phase 1 G remains preserved; unrelated failures do not authorize another run.
Subscription usage shares remain unavailable unless exposed reliably by the
provider. Missing usage must not become zero or create an unbounded launch.

## Evidence in progress

`phase7-migration-20261008-a` passes eight groups on new disposable database
`apply_e2e_6b4f79f4b488` after 65 baseline migrations. Target
`20261010000000_controlled_concurrency`, SHA-256
`5a44e207fc47650162f77ee5c6a37a42568accae1c55455d6f3ef58f52290c59`.
The seed contains two synthetic users, queued/live/submitted work, three historical
scores, an original resume row, an ambiguous attempt and a recorded application.
The verifier compares every legacy column in all 62 pre-existing tables. Only
the six explicitly allowed live-lease parking fields change; historical evidence
is preserved. Every old account receives a conservative policy. No execution or
domain reservation is backfilled, and no work is requeued.

Rollback probes verify three slots, reject duplicate live work/worker/browser/slot,
reject cross-account execution pointers, enforce policy bounds and mutually
exclusive release/consumption, and enforce a unique durable domain pacing key.
The database is preserved and bridge 15434 is closed. No model, provider or employer
request ran. This proves migration preservation/constraints; runtime scheduling,
browser isolation and rendered controls still require their independent gates.

`concurrency-20261008-a` passes all 12 database groups on disposable
`apply_e2e_f4360d41b442`: policy revision races and lost acknowledgements, three
simultaneous owned claims, identity replay, daily/company limits, domain cooldown
across service restart, parked/expired leases, ambiguity after source deletion,
submission-time limit/scope rechecks, tighter campaign/Pilot caps, actual compiled
PDF corruption/reselection, and joint-capacity estimates without execution writes.

The outer runner incorrectly expected `status: passed` while the verifier emitted
`passed: true`. Its failed wrapper report is retained. The corrected harness now
validates the explicit database evidence separately. Read-only capture
`concurrency-evidence-20261008-a` fingerprints the same synthetic database, copies
verified storage and retains the original report hash without repeating any test,
creating a database, migrating, or executing a model. The original report/database/
storage remained unchanged. UI verification uses that capture as its source.

`concurrency-ui-20261008-a` stopped during clone login setup, before services or
rendering: the test helper used nonexistent two-factor fields. The clone is
`apply_e2e_1d3375e6842c`; its failed report and source-integrity pass are preserved.
A generated synthetic password hash in the Prisma diagnostic was redacted while
retaining the failure and invalid field names. The helper must use the actual User
schema and safe diagnostics. This setup failure does not invalidate the database
checks or authorize repeating application/model work.

The corrected login helper now accepts only actual typed User fields and records a
safe error category, never a Prisma invocation or its values. Two focused tests cover
the field set and diagnostic redaction. `concurrency-ui-20261008-b` passes all seven
rendered observations on new clone `apply_e2e_af062efbf718`, without repeating the
database/application groups. It verifies an unavailable companion, estimate-read
recovery, stale policy reload, lost acknowledgement, same-request manual recovery,
persisted limits/pagination, and whole-queue estimates across filters. Three policy
requests share one request ID; only one policy revision is committed. Two auth requests
run; no claim, application, model or provider action runs. Source and clone integrity
checks pass, the bridge closes, and screenshots are retained beside the report.
Visual inspection confirms distinct limits/estimate sections and explicitly
unavailable model usage and Pro remaining figures.

Evidence paths under `.temp/concurrency-regression/`:

- `phase7-migration-20261008-a/`
- `concurrency-20261008-a/` (passing database checks, failed outer wrapper preserved)
- `concurrency-evidence-20261008-a/` (read-only capture of those checks)
- `concurrency-ui-20261008-a/` (setup failure preserved with diagnostic redaction)
- `concurrency-ui-20261008-b/` (seven passing rendered observations)

Captured database SHA-256:
`57c291f257b9f8ca0c5d1f62db45b4b1ec03663a427d11a0c904650641262a9a`.
Five-file storage snapshot SHA-256:
`1cf077e3b32081965040e701fa837558aedc94657a60f1ee7db21b96c4ec93e2`.
Original wrapper report SHA-256:
`b4207e213dfcee9fa9d83b04402d6472d593bf2ef305d842ed5843dc2b267970`.

## Local worker and browser evidence

`.temp/queue-regression/phase7-terminal-checks-20261008-a/report.json`
records 411 passing managed Release tests, six pure helper tests, two actual guest
browser tests and one Windows-to-guest wrapper test. The guest test runs three
isolated Chromium processes/profiles/endpoints with independent cookies/forms.
Preparation reads back the same retained page, rejects other ownership, and stays
network-frozen until scoped handoff. Handoff survives navigation. Per-session
deadline cleanup and late browser startup after expiry both close owned processes.
Fake model workers prove overlapping execution, distinct budget partitions,
sibling cancellation on unknown usage, no relaunch, and cleanup quarantine.

Review corrected navigation guards that reappeared after handoff, network activity
during shutdown, and cleanup of a browser that finished launching after expiry.
Uncertain startup or shutdown retains the runtime gate in quarantine. Evidence is
bounded by count and bytes and retained outside the ordinary 24-hour sweeper;
parking means a closed process with retained private profile/evidence.

`phase7-terminal-zero-20261008-b` rebuilds and starts only isolated companion 14103.
It passes with empty queue approval, zero Chat budget, no workers, zero effective
capacity, and only two auth reads. It makes no claim, model, provider, or database
mutation. The host is confirmed stopped. Normal companion 4102 is untouched.

Model grants remain application-only, exact-work-item, finite and expiring. One-use
run/allocation/launch latches prevent relaunch after uncertain outcomes. Immutable
worker partitions share aggregate request/token/subagent/time/list-price limits;
unknown usage stops siblings. Observed limits may overshoot by one in-flight
response per active worker. The dollar threshold is neither a bill nor Pro usage.
This grant does not authorize Chat, Pilot preparation, a provider switch or credits.
The broker currently accepts reviewed Greenhouse/Lever/Ashby hosts and explicitly
enabled loopback fixtures. Unknown controls within those forms may reach approved
review after preparation; entirely unsupported ATS hosts stop before model launch.
Generic arbitrary-host fallback has not been implemented or claimed as tested.

## Repository gate passed

The first gate stopped at knip's unresolved static guest-only Playwright import.
The test now uses the same runtime module-path convention as existing guest tests,
without changing its import destination or product behavior. The second gate passes
CI, knip and both type checks, then finds five stale submission-discovery fixtures:
the fake database lacks the campaign reservation query added by Phase 7. The
fixtures must model that query; production caps and submission assertions remain.
These failures do not invalidate the independently passed database/browser/UI groups.

The fixture repair adds the actual campaign-filtered query and assertions for
active/applied/begun siblings versus unrelated and unstarted jobs. The final ordered
gate is recorded in `.temp/concurrency-regression/final-gate-c/`:

| Check | Result |
| --- | --- |
| `bun run ci --colors=off --reporter=summary` | Pass, 1,403 files; nine informational template suggestions |
| `bun run knip` | Pass; existing pg configuration hints only |
| API and web `typecheck` | Both pass |
| API `test` | 1,303 pass; 4,159 assertions across 175 files |
| Contracts `test` | 50 pass; 183 assertions across 11 files |
| `dotnet test -c Release` | 411 pass, zero skipped |
| Web `test` | 243 pass; 656 assertions across 55 files |
| Independent Node harness/helper guards | 138 pass; three guest-only tests skipped on Windows |
| `git diff --check` | Pass |

The skipped Windows cases retain their prior actual guest evidence; the two new
Phase 7 browser cases ran separately in the guest and passed. Native AOT still
requires the previously missing Visual Studio C++ linker; managed Release was
built and restarted for the isolated-host checks. No full model E2E was run.

The independent deterministic Phase 7 gate is complete. Phase 8 may proceed with
code-only implementation while the live acceptance requirements below remain open.

## Unrun acceptance requirements

No real provider, parallel model application, factual final review, employer
submission, quota probe, paid credit or normal-database migration ran. Fake workers
and synthetic browser forms prove scheduling and isolation only. Model acceptance
still needs new explicit approval with exact cases and finite budgets. Phase 1 G
remains preserved, and its application behavior was not repeated. The user owns
the baseline commit; no staging, commit, push or PR occurred.
