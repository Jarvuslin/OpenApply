# Apply pipeline plan

Prepared October 8, 2026. Baseline: `openapply/trim-and-reshape`, with extensive uncommitted work. Use `concise-planning` and preserve that work. Implement phases in order; each phase needs its acceptance evidence and written result before the next starts.

Approved with the user's October 8 amendments: the user commits the baseline
before the Phase 1 commit; minimal Queue and Needs you interfaces ship in Phases
2–3; fixtures follow observed real ATS structures plus one unfamiliar layout;
every migration on a non-throwaway database requires prior approval; Pilot's
Phase 2 role is defined below.

October 8 usage amendment: the user has suspended model-driven acceptance.
First audit Claude consumption and provide the usage-efficiency report. Do not
run Claude inference/readiness, a model-driven campaign, another provider, or
paid API credits without new explicit approval. The continuation is paused.
Preserve G's passing application evidence; separate model-free infrastructure
and rendered-UI verification from agent execution. See
`docs/claude-usage-efficiency-2026-10-08.md`. This amendment overrides the earlier
automatic retry and fresh-campaign instructions below.

October 8 continuation amendment: the user asks to advance while Claude usage is
unavailable. Implement subsequent phases with code-only tests and disposable
database/browser/UI verification. Preserve all acceptance requirements; list
model-dependent and external-service gates as not run, rather than substituting
simulated evidence. These gates and the pending baseline commit do not prevent
independent implementation work. Phase 2 continues in the attached
`codex/apply-pipeline-queue` worktree, preserving the original checkout for the
user's baseline commit. Keep Claude, alternative providers, inference probes and
automatic acceptance retries disabled. The heartbeat remains paused.

### Current model-free continuation checklist

- [x] Add the durable queue, ownership/lease fences and explicit recovery states.
- [x] Route campaign, saved-job, discovery and Chat work through one queue.
- [x] Replace Pilot's execution loop with an optional queue scheduler.
- [x] Add the companion's shared queue consumer with zero-budget refusal.
- [x] Ship the minimal Queue page and direct action dispatch.
- [x] Verify transitions, submission recovery and UI using deterministic fixtures.
- [x] Record deterministic evidence separately from unrun model gates.
- [x] Collect versioned questions and verify the unified Needs-you list without models.
- [x] Add confirmed answer reuse with strict country and wording boundaries.
- [x] Verify exact document selection and scripted preparation with zero models.
- [x] Verify immutable shadow-scoring data, reports and runner refusal with zero models.
- [x] Verify controlled claims, caps, isolated browsers and budgets with zero models.
- [x] Verify local Telegram intents, links, redaction and offline behavior without external transport.
- [x] Finish the Queue experience and bounded preparation interfaces with separate model-free gates.

Current gate: G's 191 application assertions and eight aggregates remain passed.
The separate model-free `ui-g-20261008-d` run passes all ten rendered UI
observations against a verified disposable G clone, with zero model calls and
unchanged original evidence. Deterministic checks pass; native publishing lacks
the Visual Studio C++ linker. The phase commit awaits the user's baseline
commit; no fresh model run, historical clean-checkout pass or phase commit is
claimed. Model calls remain disabled pending explicit approval. See
`docs/apply-pipeline-phase-1-2026-10-08.md` for evidence.

## Approach

First prove the existing application workflow against controlled local forms, using OpenApply's own agent and its existing submission protocol. Then move dispatch into a durable queue, add question collection and reusable answers, and improve filling, scoring, throughput, and communication without weakening factual-answer or duplicate-submission guards.

## Scope

- **In:** nine requested phases; localhost ATS fixtures; real local-agent acceptance runs; API-owned queue and questions; account-scoped answer bank; scripted fillers; measured shadow scoring; isolated concurrent workers; Telegram integration; laptop web UI; phase reports and commits.
- **Out:** real-employer applications without the user's case list and approval; migrations on non-throwaway databases without approval; switching the scoring default without measured results and approval; creating external accounts/bot tokens or adding server-side AI without approval; LinkedIn Easy Apply; mobile layouts; publishing, pushing to main, force-pushing, or opening a PR.

## Baseline findings

- The pasted audit's forced Chat navigation, modal dock, Pilot/Inbox error handling, and campaign progress defects were already fixed in this chat. Preserve and verify those fixes instead of reimplementing them. Dispatch still creates Chat work, so Phase 2 remains necessary.
- The existing `scripts/mvp-fixture.mjs` is only a signup smoke fixture: it does not validate or retain submitted application fields. It cannot establish E2E success.
- The last documented five-application trial stopped during scoring and has zero verified submissions. Unit tests are not evidence that an agent completed an application.
- A regular `source: apply` campaign accepts loopback fixture URLs through the existing API. Discover intake intentionally rejects those URLs; do not loosen production URL guards.
- Scoring requires an uploaded original resume, not only structured JSON. Submission success requires a reviewed checkpoint, archived PDF, submission attempt, observed receipt, recorded application, and verified worker handback.
- The browser runs inside WSL/Lima. Serve fixtures on guest loopback and verify reachability; Windows `localhost` is not the guest's `localhost`.
- Claude sessions/workers use Sonnet and Claude one-shot inference defaults to Haiku. Codex sessions use the configured model; Codex inference is not universally Haiku.
- Scored campaign jobs may publish to the shared discovery index. Use a disposable local test database and synthetic account, not the user's application database.

## Action items and phase gates

- [ ] **1. Prove a repeatable fixture E2E.** Add Greenhouse, Lever, and Ashby fixtures based on observed real form structures, with source URLs and observation dates, plus an unfamiliar-layout fixture. Expected files: new `scripts/apply-e2e/*`, `plugin/bin/openapply-browser.mjs` and its configuration/tests, `package.json`, `knip.jsonc`, `docs/development.md`, and the Phase 1 and ATS structure reports. No product data migration expected. Pass deterministic fixture tests and a real agent run through score → tailor → fill → submit → receipt → recorded history, with exact-value and rendered-UI evidence for all four cases. Wait for the user's baseline commit before committing this phase.
- [ ] **2. Add direct queue dispatch and a minimal Queue page.** Extend `apps/api/prisma/schema/`, add `modules/work-queue/`, shared contracts/SSE, companion queue leasing, web action dispatch/progress links, and a minimal job/state/reason table with Pause/Stop and progress access. Reuse submission-attempt recovery. Migrate existing executable work explicitly, with approval before any non-throwaway database migration. Pilot remains an optional scheduler that enqueues work through this same API queue; retire its independent execution/claim path so it cannot run a second competing application loop. Campaigns, saved-job actions, Pilot, and Chat use the same dispatch and submission safeguards. Gate: every allowed/rejected transition, lease recovery, cancellation, ambiguous-submit recovery, and minimal Queue UI passes; actions enqueue without Chat and Pilot creates ordinary queue records.
- [x] **3. Collect application questions and ship the Needs-you list.** Extend `modules/job-sources/{greenhouse,lever,ashby}` and add question collection/contracts plus the minimal web Needs you page and unanswered count. Verify official public API capabilities before implementation; use code-only form inspection when fields are unavailable. Gate: public API fixtures and conditional-form fixtures produce stored questions and one deduplicated, usable Needs you list without executing posting/form instructions. Passed deterministic gate October 8; see the Phase 3 report. File-only and unresolved dynamic forms remain explicit blockers for Phase 5 preparation integration.
- [x] **4. Add confirmed answer reuse.** Add answer-bank models, APIs, matching, and question-card Save to profile. Keep exact/normalized matching in code; model suggestions require user confirmation. Gate: country scope and sensitive categories are enforced, including opposite-meaning authorization/sponsorship tests; unknown facts remain unanswered. Passed model-free migration, database and rendered-UI checks October 8; see the Phase 4 report. Unclassified answers also require confirmed country, and every match remains an unconfirmed draft.
- [ ] **5. Add scripted ATS fillers.** Add companion/browser filler modules and plugin fallback integration for Greenhouse, Lever, and Ashby. Keep unknown prose and final review on Sonnet with original-resume evidence. Gate: each Phase 1 form, conditional fields, readback, PDF identity, fallback, and one-submit-only recovery pass through the real workflow.
- [ ] **6. Measure cheaper scoring.** Extend code eligibility checks, local inference/scoring orchestration, evaluation contracts/storage, and regression tooling. Build a sanitized regression set from existing scored jobs; run Haiku beside Sonnet without changing production decisions. Gate: exact quote checks and hard filters pass; report agreement, cutoff disagreements, escalation band, latency, and usage. **Ask before making Haiku the default; keep Sonnet until approved.**
- [ ] **7. Add controlled concurrency.** Add independent browser contexts, worker leases, domain pacing, daily/company limits, and a pre-run estimate. Update `job-worker`, `auto-apply`, and `mvp-apply` contracts together. Gate: 2–3 workers cannot share form state or duplicate submits; parked jobs release capacity; caps and blocked-site rules survive restarts. Label subscription-share estimates uncertain when the provider exposes no reliable usage figures.
- [ ] **8. Add Telegram as a second channel.** Add account links, expiring one-time link codes, webhook idempotency, code-only intent handling, templates, and digests. Reuse queue/question/approval records; instructions become structured rules with confirmation and Undo. Gate: link/unlink, job-link dedupe, buttons, offline replies, and sensitive-data redaction pass locally, then against an approved test bot. **Ask before creating a bot token/account or adding any server-side model. Tokens go into environment configuration, never chat.**
- [ ] **9. Finish the Queue experience.** Refine the Queue and Needs you pages already delivered in Phases 2–3, including live browser integration, progress, and navigation badges. Remove Chat from the main navigation once Queue works, retaining contextual Chat access. Recheck prior UI fixes. Gate: laptop browser scenarios, error/loading states, actions, and submitted records remain consistent with canonical API state. **Ask for an explicit employer case list before the final real application.**

## Expected data model changes

Phase 2 implementation and deterministic core gate passed October 8; see
`docs/apply-pipeline-phase-2-2026-10-08.md`. The common queue has not been exercised
with a live provider. Unsupported auxiliary Pilot handlers are explicitly parked,
and the report lists them; full prior Pilot feature parity is not claimed. The old
model acceptance entrypoint refuses even supplied approvals until queue dispatch
and a shared campaign budget are implemented. Phase 3 proceeds without model calls.

Phase 5 independent deterministic gate passed October 8: disposable migration and
database checks, all four scripted ATS layouts, and five rendered UI observations
through a zero-budget companion. See the Phase 5 report. Its live worker handoff
and preclaim disk integrity check require Phase 7's dedicated contexts. Sonnet
final review/fallback and full live workflow acceptance remain unrun; Phase 6
continues with code-only shadow-evaluation infrastructure and no default switch.

Phase 6 independent deterministic gate passed October 8: eight migration groups,
12 database groups, seven rendered report observations and all repository checks.
See the Phase 6 report. Real shadow dispatch refuses before approval consumption:
subscription-only context isolation is not yet verified for the installed CLI.
There is no API-credit workaround. Sonnet/Haiku measurement and any default change
still require the unresolved technical gate and new explicit approval. Phase 7
continues with isolated workers, durable caps and fake-process/browser verification.

Phase 7 independent deterministic gate passed October 8: eight migration groups,
12 database groups, seven rendered policy/estimate observations, three-worker
Chromium isolation, cleanup/race checks, zero-budget host refusal and repository
checks. See the Phase 7 report. Parallel real-provider applications remain unrun;
unsupported ATS hosts fail closed. Phase 8 continues locally without creating or
contacting a Telegram bot, executing a model, or authorizing spending.

Phase 8 independent deterministic gate passed October 8: corrected migration
nine groups, database sixteen groups, rendered UI ten observations including
hanging acknowledgement recovery and exact PDF bytes/hash, rebuilt zero-grant
presence, and full repository checks. See the Phase 8 report. External test-bot
acceptance remains unrun. Phase 9 continues locally, adding a read-only per-worker
viewer, accurate status/navigation, bounded preparation execution and priority
refresh within already granted work; no model execution or grants are authorized.

Phase 9 independent deterministic gate passed October 8: eight preparation and
priority database groups, three actual guest browser checks, rebuilt zero-grant
host/disconnect checks, seventeen laptop UI observations, and the final repository
gate (1,410 API, 50 contract, 305 web, 424 terminal and 20 UI-harness tests). The UI
proof reuses preserved synthetic data; failures never replayed application/model
behavior. Review fixed offscreen activity focus and shared read-rate exhaustion.
See the Phase 9 report for evidence and the explicit remaining-acceptance table.
All independent implementation through Phase 9 is complete. Live common-queue,
scoring/concurrency, test-bot and real-employer acceptance remains unrun; preparation
and shadow dispatch also retain their technical isolation gates. The baseline
commit is still the user's task, all work remains uncommitted in the attached
worktree, and the heartbeat remains paused. Do not interpret this independent
completion as permission to resume models, probes or acceptance campaigns.

| Phase | Records and constraints |
| --- | --- |
| 1 | Fixture run/submission/receipt JSON outside the production database; existing application models in a disposable database. Synthetic identities and original resumes only. |
| 2 | Work item kind/state, owner, campaign/job linkage, lease/heartbeat, idempotency key, attempts and terminal reason. Per-job states: queued, preparing, ready, filling, needs_user, submitted, skipped, failed. Separate durable submission attempts retain unknown/receipt-pending states; a crash must never downgrade ambiguity to a safe retry. |
| 3 | Job question identity, exact text/options/type, source/version, required/conditional rules, category, collection timestamp, and owner-scoped resolution. |
| 4 | Exact and conservatively normalized question, category/country context, typed answer, confirmation/provenance, revision, and reuse constraints. Sensitive answers need exact normalized matches after confirmation. |
| 6 | Evaluation pair/run, model/version, input hashes, evidence quotes, scores, hard-filter result, decision disagreement, measured latency/usage. Keep production score selection unchanged during shadow evaluation. |
| 7 | Account daily limits, company-period counters, domain pacing, worker claims/context ownership, and durable reservations. Code enforces caps atomically. |
| 8 | Telegram account link, hashed expiring link code, processed update/button IDs, delivery/digest state, and structured rule/audit records. No second question or application source of truth. |

Use Prisma enums mirrored in contracts and enum-parity tests. Use additive migrations plus explicit backfills/cutover; do not add read-time compatibility shims. Final schema names depend on the existing models inspected at each phase.

## Phase 1 execution details

1. Capture the dirty-tree baseline and create a `codex/` feature branch without discarding or staging unrelated changes. Record pre-existing failures separately.
2. Inspect current public Greenhouse, Lever, and Ashby forms read-only and record sources/dates. Base the guest-loopback fixtures on their real structure and add an unfamiliar layout, covering single/multi-page forms, required/conditional questions, resume upload, independent authorization/sponsorship answers, grounded why-us text, and a confirmation receipt. Validate on the server and retain exactly what was submitted plus upload hashes.
3. Test fixture validation, conditional visibility, malformed/missing uploads, opposite-meaning questions, receipt identity, and duplicate submission handling without models. Direct test submissions validate fixtures only and never count as application E2E passes.
4. Add a one-command runner with bounded timeouts, redacted evidence, and preflight checks for the isolated local database/API/storage, companion, signed-in provider, visible browser, and host/guest loopback. Never reset the user's database or interrupt an active agent run.
   Runtime discovery found that the browser launcher hardcodes one CDP port. Add validated loopback port/output-directory configuration and start a dedicated headed browser profile for the fixture run, leaving the connected normal companion's browser separate.
5. Seed only synthetic profile/original-resume data and queued fixture jobs through normal APIs. Dispatch `apply campaign <id>` through the current companion/Chat route until Phase 2 replaces it. Explicitly request a new tailored variant to exercise tailoring. The harness must not write scores, checkpoints, receipts, or applied results.
6. Verify the real agent's submitted fields and uploaded PDF against the immutable checkpoint, original-source scoring, variant artifact, receipt, submission attempt, application and worker-result check. Require exactly one submission/application per fixture and fail on swapped sponsorship answers.
7. Verify actual Dashboard, Applications, and Analytics rendering, in addition to their API aggregates. Preserve screenshots/observed UI evidence separately from logs. Record every manual step and any stage that did not execute.
8. Run required checks, write the phase result, and commit only the phase's changes once its acceptance gate passes and the user has committed the baseline. Do not start Phase 2 on an infrastructure-only or simulated success.

## Validation and reporting

Before each phase commit: `bun run test`, `bun run ci`, `bun run knip`, and `dotnet test -c Release` (avoids locking the running development host). Add API/web type checks and focused integration/E2E checks for changed code. Use the repository's `verify` and `commit` skills before committing; use `restart-terminal` after C# changes and `add-api-route` for new API routes. Never run unsafe Biome fixes.

Keep deterministic Bun/.NET tests distinct from model-backed acceptance. A completed Chat run or fixture HTTP 200 is insufficient. Phase reports under `docs/` must list commands, passed/failed/not-run stages, run IDs and non-secret evidence paths, blockers, and the next allowed step. No passwords, tokens, verification codes, or real applicant data in reports. No push or PR without asking.

## Open questions and approval gates

- No new model execution is authorized. Later dispatch requires explicit case-specific approval and finite budgets; do not probe quota or restart acceptance automatically.
- Keep application evidence, model-free infrastructure and rendered UI as separate gates. An infrastructure/UI failure does not invalidate already-proven application behavior or authorize another campaign.
- The user will commit the existing baseline before the Phase 1 commit. Preserve other work and do not stage it into a phase commit. Verify the baseline commit before committing the phase; do not claim a clean-checkout pass without a reproducible committed baseline.
- Ask before running any migration on a non-throwaway database. Local tests may migrate only the uniquely created, verified disposable fixture database.
- Haiku default, external Telegram account/token creation, server-side model spend, and real employer case selection remain explicit user decisions at their respective gates.
