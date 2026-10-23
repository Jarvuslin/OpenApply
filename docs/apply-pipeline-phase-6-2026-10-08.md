# Phase 6: shadow scoring infrastructure

Prepared October 8, 2026 after Phase 5's independent deterministic gate and
immutable snapshot. Continue with concise-planning in the attached worktree.

Status: independent model-free gate passed. Shadow storage, validation, reports
and runner refusal are verified. Actual model comparison and subscription-only
context isolation remain unrun/unresolved; this is not full Phase 6 acceptance.

## Approach and scope

Compare immutable scoring inputs and validated outputs separately from production
scores. Build the storage, eligibility checks, spending guards and reporting now;
keep the actual Sonnet/Haiku comparison disabled until a finite run is explicitly
approved. Historical judgments are references, not ground truth.

In: account-owned evaluation snapshots/results, exact quotation and hard-filter
validation, sanitized regression evidence, a local approval-gated runner, measured
versus unavailable metadata, and a read-only report. Out: inference during this
phase's current continuation, production score/default changes, normal-database
migrations, API credits, and re-executing prior application acceptance.

## Plan

- [x] Store immutable evaluation runs, case snapshots and result slots separately.
- [x] Validate quotes and score arithmetic with the existing pure scorer.
- [x] Add conservative exact-span eligibility checks with unresolved unknown facts.
- [x] Preserve a sanitized historical corpus and separate authored edge cases.
- [x] Build one-use, finite-budget runner controls with zero retries; block real dispatch.
- [x] Report pair coverage, disagreement, escalation, timing and usage provenance.
- [x] Show pending versus measured evaluations without changing production scores.
- [x] Verify disposable migrations, data isolation, runner refusal, and UI separately.

## Measurement boundaries

No model requests are approved. Missing model, request, token or timing metadata
is unavailable, never zero. Synthetic results cannot enter measured provider
comparison metrics. Show total cases and valid-pair denominators, with failures,
excluded and unrun cases visible. Do not infer Claude Pro percentage from token
counts or convert list-price equivalents into a bill.

The CLI's observed usage limits can overshoot during an in-flight response;
provider transport retries are not fully exposed. Hard local launch and output
limits must remain distinct from observed token/request stop thresholds. Do not
claim a provider-enforced ceiling that the current interface cannot guarantee.

Preserved Phase 1 G has four synthetic, rubric-version-2 assessments (12 criteria
each), all scoring 100. They are useful historical integrity fixtures, but alone
are not representative evidence for a cheaper-model default. Borderline/negative
authored cases must be labeled separately, and any live comparison remains unrun.

The existing resume-extraction `/inference` route has a different prompt and loses
usage metadata. The shadow runner must be separate, with no queue claim, browser,
plugin tools, server-side model, application submission or automatic retry.

## Deterministic evidence

The historical corpus is preserved in `scripts/scoring-regression/fixtures/phase1-g.json`.
All four original assessments reproduce exactly against their original rubric-2
contexts. Source report SHA-256:
`92e44b827dcaf90192302b457d95927d28ef29138d431e0c2b06a6419d1ff0aa`;
original-text SHA-256:
`513de93c83f21183a5e581d3580dfb4de3a1d6cc6c0703034eadef93a4fe195d`.
The exporter whitelists scoring fields and refuses another applicant/run or changed
source hashes; three focused tests pass eight assertions. No score was regenerated.

Migration `phase6-migration-20261008-a` passes eight groups on newly created and
verified `apply_e2e_1ee34c608594`, after 64 baseline migrations. Target
`20261009000000_shadow_scoring`, SHA-256:
`e547683d932440544629e7bc58aba22bd971f67d41bc5eecd9e6234e3a0b098b`.
All 59 pre-existing tables remain byte-identical, including a historical score,
original resume row, queued work and an ambiguous attempt. New evaluation tables
remain empty. Composite ownership, case/policy bounds, blind input, fixed model
slots, historical provenance and completed-result constraints pass rollback probes.
The database is preserved and bridge 15434 closed. No normal database was used.

`scoring-20261008-b` passes all 12 database groups on new disposable
`apply_e2e_30167cb53bc2`. Concurrent admission/results are idempotent; immutable
slots cannot be replaced. Wrong contexts and invalid exact quotes cannot become
successful results. Human-confirmed country facts, owned pagination, deleted-source
snapshots, and unchanged production scores, queues, campaigns, resumes and original
file bytes are verified. Database fingerprint:
`d2f36b3ea268fd46262051a4d9fdb6c8c062d255af04dc8d1f17175164b6d6a5`.

`scoring-ui-20261008-a` passes seven rendered observations using disposable clone
`apply_e2e_1283a100af42`, with no migrations or application/model writes. It covers
Analytics navigation, an injected read error and recovery, persistent list/case
pagination, unrun comparisons, excluded synthetic pairs, exact source/provenance
details and run-wide denominators. Screenshots were inspected. Both clone data
(apart from login refresh tokens) and preserved source database/report remain
unchanged. Two authentication requests occurred; product API writes, model calls,
provider processes and employer submissions are zero. Companion status reads were
blocked intentionally by the read-only observer. All owned services were stopped;
database bridge 15433 is closed. Evidence is under `.temp/scoring-regression/`.

The final ordered repository gate passed: Biome (1,367 files), Knip (only existing
`pg`/`@types/pg` configuration hints), API and web typechecks, 1,286 API tests
(4,088 assertions), 50 contracts tests (183 assertions), and 401 .NET tests.
Web verification passed 238 tests (626 assertions). Scoring harness guards passed
seven Node tests plus three corpus tests (eight assertions); the new strict
historical-input projection test is included in the API suite. The ordinary
application harness tests passed 96, with two guest-only tests skipped on Windows;
this command launches no model acceptance campaign. Logs are retained alongside
the phase evidence. No code changes followed the successful gate.

## Runner boundary and technical blocker

The wrapper and managed companion command both refuse before reading/consuming an
approval, discovering authentication, or locating a provider executable. Root
verified both entrypoints with nonexistent input paths; each returned the context
isolation refusal. There is no CLI/environment bypass. Neither invocation started
a provider, service, browser or inference request.

Static inspection of installed Claude version `2.1.294.0` found that `--bare`
disables OAuth/keychain authentication. The normal path's `claudeMdExcludes`
does not exclude managed instructions. Exact approved prompt isolation therefore
remains unverified for subscription authentication. No API-key workaround was used.
Binary SHA-256: `1f6471eb5a1c21a1f8b54a7827329d64433424dcce51717a54e837adb542163a`.
Only version/help implementation metadata was inspected; no readiness command ran.

The internal fake-process path verifies exact dataset/prompt/schema/case/model
hashes, expiring one-use approvals, permanent run/slot reservations, sequential
execution, cancellation, bounded input/output and aggregate request/token/time
stops. Unknown usage stops execution. Cross-runtime hashing preserves Unicode.
Model names, hashed request identities and numeric usage are distinct from the
requested model slot; raw provider text is not report metadata. The CLI dollar
threshold is a list-price-equivalent safeguard, not a Pro percentage or permission
to spend credits. No automatic retry removes a reservation or replays a slot.

Worker verification passed 401 .NET tests (27 new shadow tests), built managed
Release, and passed four wrapper tests. All provider processes in those tests
were fake scripts. Native AOT publishing still needs the previously missing
Visual Studio C++ linker; the managed executable was used for refusal checks.

## Preserved failed verification

`scoring-20261008-a` created only verified disposable `apply_e2e_f2c53a63fefa`.
Database identity, concurrent run admission, exact historical snapshots, and
foreign/stale-source rollback passed. Result admission then failed because the
test fixture supplied derived historical assessment fields to the strict judgment
input schema. The original failure/report/database are preserved. This is a
fixture DTO mismatch, not evidence that new model output is needed. Its correction
is verified in a fresh database run; no application or model stage was retried.

## Unrun acceptance requirements

No Sonnet/Haiku comparison, live scoring request, Pro readiness probe, alternate
provider, paid API credit, production migration or default switch occurred.
The real comparison requires both verified subscription context isolation and
new explicit finite-budget approval. The four historical positive cases alone
cannot justify a model default change. API usage metadata is runner-reported,
not independently attested provider billing. Production selection stays Sonnet.

Phase 1 G's application evidence is unchanged. The user still owns the baseline
commit; no files were staged, committed or pushed.
