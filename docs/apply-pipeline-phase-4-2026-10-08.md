# Phase 4: confirmed answer reuse

Prepared October 8, 2026. The deterministic Phase 4 gate passes in the attached
`codex/apply-pipeline-queue` worktree. No model calls, provider changes, normal
database migrations or employer applications were made or authorized.

## Plan

Store only explicitly consented, human-confirmed question answers as reusable
entries. Match compatible questions in code and offer the saved answer for review
on the current application. Preserve exact wording, country and revision boundaries.

- [x] Add account-owned entries and immutable save/revoke revisions.
- [x] Save an answer and reuse consent atomically with the question response.
- [x] Match exact conservatively normalized definitions and typed option mappings.
- [x] Require confirmed matching country for sensitive and unclassified answers.
- [x] Populate drafts from saved matches, retaining current-question confirmation.
- [x] Add a paginated saved-answer list with provenance, correction and revocation.
- [x] Verify ownership, stale/revoked revisions, ambiguity and opposite wording.
- [x] Verify migration, real database transactions and rendered UI without models.

## Boundaries

Existing profile defaults are not confirmation evidence. In particular, legacy
authorization booleans and demographic defaults cannot seed this bank. Initial
entries must point to an owned Phase 3 answer confirmed by a signed-in person.

All reuse in this phase requires confirmation for the current question. Matching
never writes an answer on an agent's authority. Unknown country, contradictory
wording, changed options, unsupported controls, ambiguous mappings and revoked
revisions remain unmatched. No embedding/model similarity, model suggestions or
new inference is used. A saved answer cannot authorize submission or bypass the
existing factual checkpoint and question/queue guards.

Country confirmation also applies to `other`: a finite category classifier cannot
recognize every authorization, visa or health-related wording. Only recognized
contact questions can be saved without country context. Unclassified/prose answers
additionally require the same exact normalized employer and role title; these keys
do not prove two roles have identical descriptions. Every use still requires review.

## Verification

The first disposable database run, `answers-20261008-a`, migrated only its newly
created and verified `apply_e2e_6aa9b44e0923` database. It failed the immediate
saved-entry availability assertion: PostgreSQL JSONB reordered object keys, while
the comparison hashed raw and schema-parsed objects in different key orders.
This is a product defect, not an application or provider failure. Its database
and report remain preserved; no submissions or model calls occurred.

Independent review also identified source campaign deletion and employer/role
metadata writes that could race confirmation. These paths now use
the existing per-account transaction lock, with source-scope checks.
Persisted question/request hashes remain unchanged; only typed answer equality
needs canonical comparison.

Migration run `phase4-migration-20261008-a` passes eight groups on disposable
database `apply_e2e_7771d9fbcaa8`. It applied 62 baseline migrations and then
`20261008220000_confirmed_answer_bank`; migration SHA-256 is
`15cba295fcc42692ba3c0d3760ac73d4b572a95e905fa46475fbfa3ec29785c5`.
Two users, two jobs, two work items, four canonical answers and one ambiguous
submission were preserved. No bank entries were imported from profile defaults
or existing answers. Database constraints reject unconfirmed/nonhuman reused
provenance and preserve the prior human-confirmation guard. Constraint probes
were rolled back and preservation hashes checked again. Bridge 15434 is closed;
the database and `.temp/answer-bank-regression/phase4-migration-20261008-a/report.json`
remain available as evidence.

Database run `answers-20261008-b` passes 12 groups on `apply_e2e_c8b49b971364`.
It verifies atomic consent, idempotency, exact label remapping, agent/cross-owner
refusal, country and opposite wording, loaded-draft revocation, explicit correction,
ambiguous chronology, unchanged factual timestamps, deleted-source history and
profile-default exclusion. The preserved database fingerprint is
`d4cef9ad07f6f76fce562e371d071675112bed247e5068eda09f0fc8ae1ba40f`.

Separate UI run `answers-ui-20261008-a` passes ten observations on clone
`apply_e2e_967e793c21c6`: explicit country, unchecked reused drafts, stale-revision
review, human confirmation and queue release, atomic contact save, list/history
read-error recovery, history page reset, provenance and revocation after reload.
It made three intended answer requests (one injected conflict), two match lookups
and one revoke request, with no Chat navigation or uncaught runtime errors.
Screenshots were inspected. Expected authentication, offline-companion and injected
error diagnostics are retained. Source database/report fingerprints stayed unchanged;
owned API, web, browser and bridges stopped. No migration ran in the UI stage.

Repository checks pass: Biome (1,277 files), Knip, API and web typechecks,
1,193 API tests (3,701 assertions), 50 contract tests, 219 web tests (548 assertions),
and 355 .NET tests. Harness tests pass 96 with two guest-only Windows skips;
saved-answer guards pass four and question guards pass five. Logs are under
`.temp/answer-bank-regression/*-final.log`.

## Limits and next step

Correction is tested against the real database and its web controls are implemented;
the browser observer does not yet drive a full correction journey or multi-page
history traversal beyond the page-reset regression. Matching does not establish
that an employer's form or a personal fact stayed unchanged. Every use requires
current human confirmation and the existing application review/submit protocol.

All measurements above are deterministic. No real employer, provider readiness or
model-backed application was attempted. The original checkout and empty index remain
preserved; the user's baseline commit is still pending. Phase 5 can proceed with
scripted preparation, exact document identity and bounded fallback tests, while
keeping model execution and live acceptance disabled.
