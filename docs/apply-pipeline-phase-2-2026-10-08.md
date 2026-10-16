# Phase 2: common queue, model-free verification

Prepared October 8, 2026. Implementation is in the attached
`codex/apply-pipeline-queue` worktree at
`C:/Users/7474g/.codex/worktrees/apply-pipeline-queue/OpenApply`.
The original `D:/Dev/OpenApply` checkout is preserved for the user's baseline commit.
No commit, normal database migration, provider call or real application was made.

## Behavior

Application actions now admit exact saved jobs to an API-owned queue without opening
Chat. Campaign preparation, saved-job actions, discovery, Chat and Pilot share one
durable execution authority. Work items, request IDs, events and per-user leases are
stored centrally. User-row locking plus a database unique index prevents competing
companions from holding concurrent execution leases for the same user.

The Queue page shows job/state/reason, progress links, activity, offline status and
Pause/Resume/Stop. It remains usable with no companion connection. Connecting the
computer is explicit; a zero or invalid local model budget prevents claiming work.
Chat remains available and projects its conversation history from the common executor.
No model is needed to render, enqueue, answer operational questions or control work.

Submission-begin requires the current owned application work lease. A Chat or
preparation lease cannot submit. Pause, stop, expiry, wrong owner/job and old leases
reject new submission permission. Existing checkpoint/PDF/receipt/result safeguards
remain authoritative; completing a worker turn alone cannot mark an application as
submitted. Legacy ambiguous attempts stay parked. Receipt storage remains recoverable
after lease loss, without another employer submission.

Pilot is an optional code-only scheduler feeding this same queue. Its separate PTY
execution loop, stuck-session restart and legacy claim authority are retired. Existing
agenda selection and explicit provider choice are retained. Tasks without a supported
queue handler are visible as needing attention, never silently executed or completed:
paused-campaign review, interview replies, board health, strategy review/bootstrap,
automatic skipped/failed-job reconsideration and unsupported answered-question tasks.
Manual typed campaign preparation actions remain available. These automatic Pilot
handlers are a stated limitation, not evidence of full prior feature parity.

## Evidence so far

All counts below are deterministic verification, **not model-backed application
acceptance**. Synthetic state seeds do not prove that an agent applied to a job.

| Check | Result |
|---|---|
| Queue service/database integration | 11 groups passed in `queue-20261008-c`, including concurrent admission/claims, scope/lease checks, cancellation, ordered progress, idempotent/redacted events, expiry, legacy ambiguity, recorded/receipt races and shared Chat. |
| Real rendered Queue | Eight observations passed: injected read-error recovery, offline queued/needs-user state, activity detail, pause, resume, stop, reload persistence and no Chat creation/navigation. |
| Isolated zero-budget companion | `queue-zero-20261008-a` passed. Two authentication GETs only; zero claims across polling intervals. Legacy model entrypoints returned 403. Own host stopped afterward. |
| Plugin API/recovery helper | 17 tests passed, including paired lease context, no redirect forwarding, redaction and immutable receipt recovery. |
| Web tests | 201 passed; three browser request-guard tests passed. |
| Terminal tests | 341 passed; managed Release build passed. Obsolete Pilot-cycle tests were removed together with their retired implementation. |
| Repository gate | Biome (1,197 files), Knip, API/web typechecks passed. 1,116 API, 50 contract, 201 web and 341 terminal tests passed. Harness unit tests: 96 passed, two platform-specific guest tests skipped on Windows. Queue/helper guard tests: seven passed. |
| Migration backfill | Seven groups passed in `phase2-migration-20261008-b`: deploy 60 baseline migrations, seed legacy synthetic state, apply queue migration, inspect backfill and retained evidence. |

Evidence directory: `.temp/queue-regression/queue-20261008-c/`. The database
`apply_e2e_6cbf185844ad` was newly created, verified against the isolated guest cluster
`/var/lib/postgresql/mvp`, then migrated. No prior database was migrated. Source
inventories and screenshots are retained. Dedicated browser and forwarding processes
confirmed shutdown; API/web child process trees were stopped and the DB bridge closed.

Earlier attempts A and B passed their database checks but failed only in the new UI
harness adapters: a disallowed browser-profile directory, then missing observer URL
configuration. Both were fixed. Those failures remain recorded; they launched no
application agent, provider process or employer form submission. Phase 1 G evidence
was neither replayed nor modified.

Migration evidence is under `.temp/queue-regression/phase2-migration-20261008-b/`.
Its fresh disposable database `apply_e2e_2b6eea2bcbb4` is retained. The fixture had
two users, nine jobs, five chats, five questions, two Pilot claims and one ambiguous
submission. The migration created nine work items, conservatively parked applications,
retained queued Chat/history/provider, revoked old running leases, abandoned Pilot
claims and updated only exact owned legacy question references. The ambiguous
submission bytes stayed unchanged. Migration SHA-256:
`198125d86d3e32e604720a91e98652c2ffd97c5b9b284a6bdaf71399fb281ae5`.
The earlier migration run A stopped in rolled-back fixture seeding on a PostgreSQL
parameter cast; its report remains preserved. Both bridge ports were closed.

Final review also fixed expired-question UUID parsing, paused-campaign dispatch,
recurring-search generation identity, explicit provider selection and visibility of
stopped ambiguous work. Pilot's current enabled state and daily cap are rechecked at
claim and submission permission, under the same user lock; unresolved begun/legacy
reservations count conservatively. Those changes passed focused tests and the full
gate. Two inherited application test files needed line-ending normalization after
the Windows worktree checkout; no assertions were removed for that formatting fix.

The Phase 2 deterministic core gate passes. Provider execution and automatic Pilot
handlers listed above are not certified. No phase commit is made while the baseline
commit is pending. Phase 3 can proceed with model-free collection and UI checks under
the user's continuation amendment.

## Repeatable checks and boundaries

`bun run queue:verify --run-id <unique>` creates and verifies a disposable database,
runs synthetic queue transitions, starts isolated API/web/browser processes and checks
the rendered page. It never starts a companion, provider, ATS fixture submission or
model campaign. Browser requests are restricted to local reads, normal login and the
one designated synthetic work item's controls. `bun run test:queue` runs the local
request-guard/helper checks. The observer can run independently of model execution.

The separate zero-budget host check is:

```text
node scripts/queue-regression/zero-budget-host.mjs <dotnet-path> <unique-run-id>
```

The helper transmits inherited work credentials only as headers, refuses incomplete
context and redirects, and redacts echoed lease/bearer values. Queue instructions limit
application work to one owned job and use existing evidence/cache instead of broad
campaign loops. The companion owns lease renewal; model prompts do not carry lease
secrets.

No live Claude/Codex queue execution is claimed. The old full-acceptance harness used
legacy Chat claims and is disabled before consuming an approval or starting
infrastructure. Any future real campaign needs queue-aware dispatch, a campaign-wide
budget across separate leased jobs, and fresh,
case-specific approval with finite budgets. Existing G application evidence remains
valid historical evidence, not a test of the new queue runtime. Native AOT publishing
still requires the missing Visual Studio C++ linker. Model-dependent later gates and
external-service gates remain explicitly unrun.
