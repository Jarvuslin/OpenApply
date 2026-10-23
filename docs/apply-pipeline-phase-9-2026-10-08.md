# Phase 9 — Queue experience and bounded preparation

Prepared October 8, 2026. Continue with the approved concise-planning workflow.
Finish the Queue experience and close the preparation/priority gaps found in
Phase 8 using deterministic checks. Preserve prior application evidence;
infrastructure or UI failures never authorize another agent campaign.

## Scope

- In: Queue activity and read-only per-worker browser view, canonical badges,
  truthful connection status, contextual Chat, bounded intake preparation,
  priority refresh within an existing exact grant, separate regression gates.
- Out: provider calls or readiness probes, model grants, API credits, external
  bot traffic, employer applications, non-throwaway migrations, staging/commits.

## Action items

- [x] Preserve the Phase 8 boundary: snapshot `phase8-model-free-20261008`
  contains 1,093 files and 29 deletions at baseline `18433567`.
- [x] Bind preparation to an immutable intake/job/resume snapshot and a narrow
  live-lease capability that cannot access general account mutations.
- [x] Add a separate finite preparation grant and read-only browser workflow;
  refresh application priority only among work already explicitly granted.
- [x] Add bounded, account-bound worker frames without renewing leases,
  exposing browser control, or cancelling execution on viewer errors.
- [x] Finish inline Queue activity, canonical counts, connection states and
  navigation; retain contextual Chat access.
- [x] Verify targeted contracts, fake workers and browser isolation without
  provider execution, then rebuild and check the isolated zero-grant host.
- [x] Verify rendered laptop scenarios from disposable synthetic evidence,
  including loading, errors, controls and retained application records.
- [x] Run required repository checks, record exact passes/limits and preserve
  the final phase boundary.

## Acceptance boundaries

The independent gates do not establish live provider, Telegram or real-employer
acceptance. The existing Phase 1 Run G application proof stays valid and must not
be rerun because another layer fails. Phase 6 subscription-only shadow isolation
remains unresolved. The continuation heartbeat stays paused. The user still owns
the baseline commit, so no phase commit or clean-checkout claim is made.

No model call or execution grant is authorized for this phase's implementation.

## Implementation

Queue activity is inline and keeps the job list accessible at laptop widths.
The explicit View browser action fetches bounded, read-only frames for one exact
account/work/execution/browser identity. It clears failed, stale or mismatched
frames, stops polling on close and never renews a lease or controls execution.
The host authenticates each read, including cached frames, and captures only
the worker's original job tab. Popup tabs and the shared desktop are not shown.

Queue's navigation badge counts canonical queued/running work. Needs-you counts
canonical questions separately from blocked work. Unreachable companion status
means unknown; connected status does not imply a model grant. The connection
panel and sidebar share account-scoped state. Chat leaves the main navigation
but remains available from job context and uses the same connection component.
The advanced terminal remains collapsed initially and expands inline.

Preparation now binds an immutable intake/job/campaign/original-resume/preferences
snapshot. Its separate, expiring live-lease capability can access only preparation
context, posting, fit and collected questions. Ordinary account tokens cannot use
those routes; preparation tokens cannot use ordinary account routes. Every read
rechecks ownership, the live lease, source bytes and snapshot revision. Reused
fit data is compact; the helper does not echo full documents or answer values.
Legacy preparation payloads have no new authority. Prepare again creates fresh
bounded work; individual and campaign Resume cannot revive preparation work.

Priority refresh only reorders unspent work IDs already in an exact finite grant.
The ordered read cannot add work or replace the atomic claim check. Work-item
responses expose a validated, owned intake link without exposing execution
payloads or capabilities.

Review found a disconnect race: an old tab could disconnect a newer account or
same-account connection. Both Queue and Chat disconnect routes now require a
verified bearer, expected owner and exact connection generation, with a locked
recheck after authentication. Token acquisition, queue controls and limits updates
also have a 15-second deadline through headers, body and session recovery; timed
out mutations are never automatically replayed.

Preparation has a remaining technical boundary: the subscription provider's
general tools and inherited user context have no verified enforced isolation.
The production preparation path must therefore refuse before claim, browser or
budget consumption. Scoped capabilities and fake-executor tests do not establish
live readiness. A finite approval alone cannot clear this technical gate.

## Disposable database proof

`phase9-preparation-db-20261008-a` passes eight groups in the fresh verified clone
`apply_e2e_4c3735cdcc2d`, without migrations. The groups cover immutable scope and
idempotency, capability/account-token separation through HTTP, narrow writes,
preserved synthetic fit judgments and reuse, source/revision invalidation, exact
observer ownership without lease renewal, priority within the requested set, and
legacy rejection plus explicit supersession/revocation.

Measured fixture actions: two synthetic claims, one question collection and one
stored score using preserved judgments. Model requests, provider processes,
external requests and employer submissions are all zero. Source integrity and
bridge cleanup pass. Evidence is under
`.temp/intake-preparation-regression/phase9-preparation-db-20261008-a/`.
Later DTO projection and campaign-resume corrections have focused unit coverage;
the passed database proof was not replayed for unrelated UI failures.

## Terminal and browser proof

Evidence under `.temp/queue-regression/phase9-terminal-checks-20261008-a/` records
424 managed Release tests, a zero-warning/error build, nine pure Node checks,
three actual guest Chromium checks and one Windows browser-wrapper check. The
initial malformed-priority classification failure remains recorded; it was fixed
before the claim/allocation latch. The final disconnect-specific logs supersede
the earlier passing terminal run and retain all failures.

`phase9-terminal-zero-20261008-b` checks the rebuilt isolated host at port 14103
with a stub API and zero grants. It records three authenticated reads and two
runtime-presence writes, no claims, no model calls and no database mutations.
Unauthenticated disconnect is refused without changing the generation; the
authenticated exact-generation disconnect stops the connection. The isolated
host is stopped afterward. The normal companion at port 4102 was not restarted.

Fake grants in tests authorize only in-memory fake executors. The terminal's
production preparation path still refuses before claim, browser startup or grant
consumption. No actual model approval was created or consumed.

## Preserved UI evidence

The UI fixture derives from the passing Phase 8 synthetic database and its
hash-verified storage. Seed and observation are separate commands, so an observer
failure does not rerun seed, application or agent behavior.

- `phase9-seed-20261008-a` failed before bootstrap because intentionally blank
  Telegram credentials were rejected by optional environment validators. Blank
  disabled values now normalize to undefined; invalid nonempty values still fail.
  Six environment tests cover the correction. Explicit blanks remain necessary
  to prevent Bun from inheriting credentials from local configuration.
- `phase9-seed-20261008-b` failed the owned-slot database constraint. The two
  simulated viewer rows now remain queued with no real execution, lease or grant.
  Only the separately labelled viewer observation overrides their exact detail
  responses. Fixture diagnostics expose fixed categories, not credentials.
- `phase9-seed-20261008-c` passes in `apply_e2e_7ec82ad30e01`: five synthetic work
  items, three Needs-you questions, one blocked work item, one explicitly seeded
  synthetic application and a retained PDF. No submission occurred. Migrations
  are zero; source integrity passes. Storage fingerprint is
  `dacabf8bf2487f3a57be94313115533f77d588d19072d178bf20518be0427947`.
- `phase9-ui-20261008-a` reused seed C in clone `apply_e2e_eddc3e16bc0a`. Thirteen
  observations passed before the Pilot error-state observer encountered the
  intended Advanced tools gate. Source and clone integrity and cleanup pass.
  The run performed no seeding or model execution. The corrected observer enables
  the local Advanced tools preference before Pilot; the failed report is preserved.
- `phase9-ui-20261008-b` reused seed C in `apply_e2e_ee8f7c0fb213`. All sixteen
  scripted observations completed and no request was blocked, but the final
  diagnostic audit correctly failed on real Queue API 429 responses. The read
  routes incorrectly shared one 20-request/minute bucket: normal list/summary
  and open-activity polling already consume that allowance. Reads now have
  separate route buckets; execution and mutation limits remain unchanged. No database
  proof, seed or application behavior was repeated. Both integrity checks pass.

Screenshot review also found that the original visibility assertion missed an
offscreen activity panel after clicking a low row. The product now focuses and
scrolls the activity into view on each explicit opening, including the same item,
and Close returns focus to its originating button. Background refreshes do not
move focus. The final observer must assert actual viewport intersection and
focus restoration; A/B's weaker visibility checks do not prove this behavior.

Rendered frame evidence uses explicit synthetic companion status, two exact
active-detail responses, a fake terminal token and JPEG responses. It establishes
UI behavior only. Actual broker capture/ownership and disconnect behavior have
the separate terminal/browser proof above. UI request policy denies execution,
submission, preparation, grants, companion connection and external traffic.

## Repository checks

`final-gate-a` stopped at one observer formatting issue. A safe Biome fix corrected
it. The ordered `final-gate-b` passes all steps; logs are under
`.temp/queue-experience-regression/final-gate-b/`:

| Check | Result |
| --- | --- |
| CI / knip | Pass; informational template/configuration hints only |
| API / web type checks | Both pass |
| API tests | 1,406 pass; 4,567 assertions |
| Contract tests | 50 pass; 183 assertions |
| Managed Release terminal tests | 424 pass; zero skipped |
| Web tests | 305 pass; 807 assertions across 60 files |
| Existing application/queue harness guards | 103 pass; two guest-only skips |

The skipped host tests are not newly claimed browser passes; prior guest evidence
is preserved. Native AOT publishing still lacks the Visual Studio C++ linker.
Managed Release checks do not remove that build limitation.

## Final independent gate

`phase9-ui-20261008-c` passes all **17 rendered observations** on the fresh clone
`apply_e2e_5ee93efc684b`, reusing seed C without migrations or reseeding. Evidence,
screenshots and the exact request audit are under
`.temp/queue-experience-regression/phase9-ui-20261008-c/`.

At 1366×768 and 1440×900, the checks establish loading/error/retry behavior,
canonical counts, visible inline activity with focus on opening and reopening,
focus restoration on Close, target-only Pause/Resume/Stop with persisted Stop,
the unified Needs-you list, the synthetic submitted record and exact PDF bytes,
contextual Chat without messages or execution, worker/frame identity and stale
error handling, account separation, Pilot/Inbox errors, and the initially
collapsed inline terminal. Screenshot review confirms the previously offscreen
activity is now visible beside the Queue.

Measured requests include three explicit control actions, one existing-thread
lookup, two intercepted fake token requests and four intercepted frame responses.
There are zero blocked requests, unexpected browser errors, provider processes,
model calls or employer submissions. Expected injected error responses and
development warnings remain recorded; they are not silently removed. Source
database/storage/report, protected clone records/storage and staged source checks
all pass. The disposable bridge and owned services are closed.

The read-limit correction retains 1,200 reads/hour with burst 80 separately for
each normal Queue read route. Exact authenticated observer reads allow 7,200/hour
with burst 20, enough for three workers polled every two seconds. Fake-clock tests
cover an hour of 8,340 total reads, independent owners/routes and observer
throttling with Retry-After. Mutation and runtime limits are unchanged.

After the final focus and read-limit changes, the ordered `final-gate-c` passes
CI, knip, both type checks, **1,410 API tests / 4,584 assertions**, 50 contract tests
/ 183 assertions, **424 managed Release terminal tests**, **305 web tests / 807
assertions**, and **20 UI-harness guard tests**. `git diff --check` also passes.
The unchanged prior browser, zero-grant host and application-harness proof is
retained instead of repeating it for the UI correction.

The independent Phase 9 gate is complete. The byte-preserving final boundary is
`.temp/apply-pipeline-continuation/phase9-model-free-20261008/` in the attached
`codex/apply-pipeline-queue` worktree. This does not stage or commit files. The
original checkout remains at baseline `18433567`; the user owns its baseline
commit. The continuation automation remains paused.

## Remaining acceptance gates

| Scope | Still unrun or blocked |
| --- | --- |
| Queue, question reuse and fillers | Live provider acceptance of the new common execution path; retained Phase 1 G evidence is not relabelled as a new-queue run |
| Scoring | Actual Sonnet/Haiku comparison; verified subscription-only context isolation and explicit approval are required before dispatch |
| Preparation | Production dispatch remains technically disabled pending enforced tool/context isolation; a model approval alone cannot enable it |
| Concurrency | Real-provider concurrent application acceptance; unsupported ATS hosts continue to fail closed |
| Telegram | Approved external test-bot linking/delivery; no bot/account was created or contacted |
| Final application | Explicit employer case list and approval, followed by live acceptance |
| Reproducibility/build | User's baseline commit and later phase commits; native AOT needs the missing Visual Studio C++ linker |

No full nine-phase live acceptance claim is made. There is no automatic retry,
quota probe, provider switch, paid API workaround or model-default change. All
independent implementation and model-free gates through Phase 9 are recorded;
the remaining gates must be addressed explicitly when their prerequisites exist.
