# Claude usage and acceptance efficiency — October 8, 2026

## Finding and immediate containment

The main avoidable consumption came from the development workflow's acceptance
policy. The harness coupled application execution and rendered UI into one
result, and the development assistant responded to an infrastructure/UI failure
by creating another campaign. That repeated scoring, four new resume rewrites,
browser reasoning, reviews, and application recording. Requiring a fresh model
run after G's isolated UI failure was unnecessary; this was a workflow decision,
not a requirement imposed by Claude or by submission safety.

G already has 191/191 application assertions and 8/8 aggregates passing for all
four fixtures. Its original overall result remains failed because UI observation
failed. Preserve that report and its application evidence. Verify the remaining
UI stage independently against a disposable clone of G's synthetic data.

The `finish-apply-pipeline` continuation is now **paused**. Its prompt prohibits
provider probes, model-driven acceptance, provider changes, and paid API usage
without new explicit approval. No Claude invocation, model-driven acceptance,
provider switch, or credit purchase was performed for this investigation.

## What uses the Pro allowance

This development conversation runs in Codex; its own reasoning and local file
tools are not Claude inference. Its explicit `claude -p` probes and the OpenApply
campaigns it launches do execute Claude. Local OAuth metadata identifies the
configured subscription as `pro`. Current process environment checks found no
Anthropic API-key/auth-token/base-URL or Bedrock/Vertex/Foundry routing overrides.
Only presence flags and subscription metadata were inspected for this finding;
no credential values are included here. This is current configuration evidence,
not a historical billing export for every process.

Subscription-authenticated Claude Code work shares the account's Claude usage
limits. An API-key route is separately metered; none is authorized for this task.
See Anthropic's [Pro/Max and Claude Code documentation](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

The following describes the architecture during the measured campaigns; the
implemented controls are recorded at the end of this report.

| Execution entry point | Model work and allowance exposure | Control or gap during campaigns |
| --- | --- | --- |
| Development readiness probes | Real Sonnet `claude -p` requests, even for a four-token answer | Ad hoc result files; no shared spend ledger |
| Harness `startCompanion()` | `/inference`, `model: sonnet`, `check: true` generates `OPENAPPLY_READY` | Duplicates the external probe; usage discarded |
| Chat application run | Claude parent, score/apply workers, any available reviewer; observed campaign model is Sonnet | No request/token/turn budget; harness only has a 60-minute timeout |
| Per-job browser loop | Each reasoning turn consumes inference; Playwright itself does not call Claude | Tool results grow the next request's context |
| Tailoring/review/humanizer | Model prose/review work; a Skill tool invocation is not itself necessarily a distinct inference process | Fresh-variant requirement on every acceptance retry defeats reuse |
| Interactive terminal | Claude PTY turns and injected skill prompts | No structured usage ledger or model budget |
| Pilot | Claude cycles, clear/restart, check-in and recovery prompts; even empty-queue decisions can enter the model loop | Time/backoff controls, no token/request cap |
| Resume extraction/connection checks | Default Haiku inference; explicit Sonnet retry exists | Three turns/two minutes, one concurrent inference; usage envelope discarded |
| Gmail connection check | Haiku with bounded connector tools | Eight turns/90 seconds; usage discarded |
| API scoring/tailoring endpoints | Code validates agent-supplied assessments and builds artifacts; no server-side Claude launcher found | Existing scoring cache remains useful |
| Version/auth metadata, database/API calls, compilation, Playwright observation, deterministic tests | No model inference by themselves | These must remain separate from readiness generation and dispatch |

Source references: `scripts/apply-e2e/{run,environment,environment-preflight}.mjs`;
`apps/terminal/Chat/{ChatProcess,ChatRuntime,ClaudeChatProtocol}.cs`;
`apps/terminal/Inference/InferenceEndpoints.cs`; `apps/terminal/Pilot/`;
`apps/terminal/Connectors/{GmailCheckEndpoints,GmailCheckProtocol}.cs`;
`plugin/agents/job-worker.md`; `plugin/skills/_shared/rewrite-quality.md`.

## Measured consumption

The private reproducible aggregation is in
`.temp/claude-usage-audit/measured-usage.json` and `aggregate.cjs`. It reads local
Claude session JSONL plus retained probe result envelopes. It does not call a
model. The 760 request and message IDs are also globally unique across files;
no cross-file duplicates were found. Identifiers deduplicate repeated streaming blocks; probe
result totals are kept separate from session totals. Counts below exclude
synthetic error messages and are observed provider request identifiers, not the
number of UI clicks, tool invocations, or shell commands.

| Acceptance run | Observed campaign requests | Cache-write input tokens | Cache-read input token occurrences | Result |
| --- | ---: | ---: | ---: | --- |
| C | 60 | 275,780 | 4,466,613 | Origin rejection; ambiguous attempt correctly stopped |
| D | 55 | 234,412 | 4,090,766 | Runner interrupted |
| E | 178 | 510,460 | 14,577,174 | Four applications and UI passed; exact JD comparison failed |
| F | 155 | 496,898 | 12,665,813 | Session limit after three applications |
| G | 208 | 571,181 | 18,523,068 | All application checks passed; UI build failed |
| I | 104 | 364,091 | 7,437,207 | Session limit after two applications |
| **Total** | **760** | **2,452,822** | **61,760,641** | Six launched campaigns |

A, B, and H failed before campaign dispatch. Their zero campaign executions do
not imply that separately launched development probes were free.

Additional measurements and limitations:

- The six campaigns recorded **1,536 uncached input tokens**, **908 tool calls**,
  and **3,080,757 returned text characters**. Cache fields contain most input
  processing; reading only `input_tokens` would severely understate it.
- Session JSONL records **77,256 output tokens**, but some worker records retain
  streaming-start output counts despite long generated tool inputs. Treat this
  as an incomplete recorded lower bound, not an exact total.
- Three successful development probes recorded **three requests**, **72,958
  cache-write tokens**, **59,727 cache-read tokens**, six uncached input tokens,
  and **12 output tokens**. Each processed roughly **44,000 input-context tokens**
  to return four tokens. A fourth retained probe was quota-denied and reports
  zero usage. Its denial is not evidence that future probes are free.
- Those successful probe envelopes report **$0.3039094 at list-price equivalent**.
  This is not a Pro charge or a billed API expense. Their canonical model metadata
  names `claude-sonnet-5-5`, `firstParty`, and `costBasis: list`.
- Six launched campaigns also passed the companion's separate Sonnet readiness
  invocation. Its usage envelope is discarded and session persistence disabled;
  those invocations are an additional accounting gap, not zero consumption.
- Two other local Opus sessions overlap C–F. They contain 149 observed requests,
  560,241 cache-write tokens and 32,536,377 cache-read token occurrences. Their
  metadata names `claude-desktop` as entry point; they are not attributable to
  this Codex thread and are excluded from the campaign totals. Other devices and
  unrecorded Claude chats are outside this audit. The local aggregate stats cache
  was stale (May 5), so it was not used as an October usage total.

These input totals count repeated processing, including cached context; they are
not that many unique tokens of newly written text. Neither token sums nor a
list-price dollar estimate establish a percentage of the Pro allowance.
Anthropic does not provide a fixed public token-to-Pro-percentage conversion in
the inspected documentation. No authoritative account-wide usage/billing export
was retrieved. See [Claude Code usage/cost distinctions](https://code.claude.com/docs/en/costs)
and [cache-token accounting](https://code.claude.com/docs/en/monitoring-usage).

## Highest-cost operations and root causes

1. **Whole-campaign retries amplified every other cost.** I alone added 104
   observed requests and 7.44 million cache-read occurrences after G had proved
   all four application flows. H added no campaign execution, but another
   development probe was made. A UI/build defect did not require repeating the
   application workflow.
2. **Application workers dominate G's request count.** G used 27 parent
   requests, 11 scoring-worker requests and 170 requests across four apply
   workers (41/38/39/52). These apply workers combine tailoring, document review,
   browser actions and final review; logs do not support an exact token split
   between those operations without speculative attribution.
   Across all six campaigns, the measured split is 114 parent requests, 76
   scoring requests, 568 apply-worker requests, and two reviewer requests.
3. **Growing context is repeatedly processed.** G's workers started around
   38.6–38.9k input-context tokens. The score worker reached about 71.6k; apply
   workers reached 105.2–122.9k. G made 251 tool calls with approximately 725k
   returned text characters. These are measured context/character figures,
   not an assumption that every character costs the same number of tokens.
   In G, browser tools returned 89,601 characters across 95 calls; API tools
   returned 242,108 across 77 calls; file reads returned 151,015 across 12 calls.
   Browser loops are frequent, but it would be wrong to attribute all context
   cost to browser output alone.
4. **Instructions and tool results are repeatedly loaded.** The worker and its
   nine mandatory shared documents total 65,833 source characters before
   additional scoring/tailoring instructions, original resume, posting, profile,
   and browser output. Fresh workers isolate context but reload this material.
5. **New rewrites were mandatory on every retry.** The acceptance prompt requests
   a new genuinely tailored variant for every job. That is useful to prove
   tailoring once, not to test source staging or Dashboard rendering repeatedly.
6. **UI inspection was duplicated.** The prompt asks Claude to inspect three UI
   pages, then the runner performs its own model-free `observeUi()` checks.
7. **Tiny readiness prompts were not tiny requests.** They loaded repository
   context, and the harness repeated a model readiness check internally. A
   successful probe does not reserve enough quota for the subsequent campaign.
8. **Accounting and limits were missing at the execution boundary.** Chat keeps
   text/tool activities but drops usage, model usage, cost and turn counts.
   Inference retains the result while dropping the usage envelope. Timeouts are
   not token budgets. Potential provider-internal retries, compaction and other
   background requests are not fully exposed by this retained ledger.

The external cause of G's file disappearance remains unknown. The subsequent
cross-drive Next failure is established and fixed. Neither issue justifies
invalidating G's already-passing application assertions.

## Changes in priority order

1. **Keep automatic model execution at zero.** Default development verification
   to model-free commands; reject acceptance dispatch without a fresh explicit
   approval tied to one run and specified cases. No automatic full retries,
   quota probes, provider fallback, credit fallback, or reset-triggered restart.
2. **Add a preserved-evidence UI command.** Verify G's evidence identity, clone
   its disposable database and all 25 preserved storage files, change only the exact synthetic
   user's password in the clone, and start API/web/browser only. Use normal
   login and the same ten rendered observations. No companion, inference,
   Chat dispatch, ATS submission server, or new application writes.
3. **Separate deterministic gates.** Stage/hash/compile, disposable database
   migration, API/browser transport and fixture-form tests must finish without
   invoking a model. Their failures should rerun only their own layer.
4. **Preserve evidence by stage.** Keep G unchanged. A new UI report must say
   `realAgent: not-run`, `modelCalls: 0`, include G's report hash, source/storage
   inventories, and before/after application-record fingerprints. Do not turn
   copied records into a claimed new agent success.
5. **Bound any later approved model run.** Require explicit limits on cases,
   campaign launches (one), retries (zero), parent/worker turns, elapsed time,
   and measured input/output/cache-token/request totals. Use native CLI limits
   where supported and record every stop reason. A budget stop preserves
   submission ambiguity and never authorizes replay.
6. **Retain usage at the boundary.** Capture allowlisted parent/subagent usage
   with request/message deduplication, including failures and partial runs;
   avoid logging prompts, credentials or complete tool output. Reject unapproved
   API-key/cloud routing in the acceptance path.
7. **Reduce repeat context without removing safeguards.** Remove the duplicate
   model UI task and model readiness generation. Use small code-produced input
   bundles, bounded tool results and exact field readback. Keep original-source
   evidence, factual review, PDF hashes, checkpoint, one-submit guard, receipt and
   worker-result validation. Model/provider changes require separate approval.

CLI `--max-turns` bounds agentic turns; subagents have their own `maxTurns`.
`--max-budget-usd` uses an estimated dollar counter and includes subagents; it is
not a Pro allowance percentage. Usage usually arrives after a response, so an
observed-token watchdog cannot promise a zero-overshoot pre-request token cap.
The strict present authorization budget is **zero model calls**. Nonzero limits
must state these enforcement boundaries rather than claiming false precision.
See [CLI controls](https://code.claude.com/docs/en/cli-reference) and
[subagent controls](https://code.claude.com/docs/en/sub-agents).

## Acceptance preservation

Treat the evidence as independently named stages: G application behavior passed;
current model-free infrastructure passed/failed; current rendered UI against
G-derived data passed/failed. A UI-only or staging-only change does not invalidate
application behavior. Changes to scoring, tailoring, actual filling, submission,
or recording require a scoped impact review and an explicitly approved model
test where deterministic tests cannot establish the changed behavior.

G was executed from a dirty checkout and lacks a complete historical source
fingerprint. Do not claim a clean-checkout pass or retroactively fabricate that
fingerprint. Future runs should capture relevant source hashes and the preserved
evidence linkage. The audit was delivered before implementation; the changes
below implement its containment and verification recommendations.

## Implemented controls and validation

- `apply:e2e` rejects execution before provisioning without a fresh, explicit
  user approval, named cases and finite budgets. A canonical per-run atomic
  claim prevents reuse even if the approval file is copied. No approval has been
  created for a new campaign. There is no automatic retry or quota probe.
- The application runner no longer stages or starts a web server. It stores
  `applicationStatus` independently before later integrity/cleanup checks, so
  unrelated failures cannot erase collected application assertions. The prompt
  no longer asks Claude to inspect UI. All original application assertions remain.
- `apply:ui` validates preserved application evidence, clones its verified
  disposable database and all 25 storage files, and runs API/web/browser only.
  The original ten rendered UI observations retain their meaning, with selectors
  corrected for the current visible status label and unambiguous statistic cards. Separate preflight and
  `--infra-only` modes never need a provider. No migration is performed by UI
  replay. Reports distinguish reused application evidence from new UI results.
- The isolated companion receives a required budget and fresh usage ledger.
  Zero denies launch before provider preparation. Nonzero execution pins Sonnet,
  requires locally verified subscription metadata, rejects alternate billing
  routes/session resume, caps parent and staged worker turns, and watches observed
  requests/tokens/subagent starts and wall time. Cumulative usage is not added
  twice. Metadata logs omit prompts, outputs and credentials.
- Budgeted hosts reject inference, terminal, Pilot, connector and update entry
  points and disable startup updates, URL registration and background Pilot
  execution. Ordinary manual hosts retain their existing behavior. The current
  normal host was not restarted; the new binary was checked in isolation with
  a zero-call budget.

Observed counters are postresponse safeguards with possible in-flight overshoot.
Native cost limits are list-price estimates. No positive-budget provider run
was performed, so real-provider operation of the new limits remains unverified;
protocol and cancellation behavior are tested with fake processes. These are
not account-wide Pro controls and do not intercept independent Claude sessions.

Validation: lint, unused-code checks, API/web typechecks, 1,068 API tests,
50 contract tests, 185 web tests, 382 terminal tests and 95 host harness tests
passed. The two browser tests skipped on the host both passed separately inside
the browser guest. Detailed rendered-UI results are recorded below. Native AOT publishing
failed because this machine has no Visual Studio C++ linker. A managed Release
publish and isolated zero-budget health/endpoint-blocking check passed. The
missing native toolchain remains an explicit build limitation.

Model-free UI debugging retained each attempt independently:

- `ui-g-20261008-a`: API staging wrongly excluded the nested source directory
  `src/common/storage` as well as runtime storage. Root-only exclusions and a
  regression test fixed this. The original G database, metadata and storage
  remained unchanged.
- `ui-g-20261008-b`: Dashboard showed four applications on load/reload. The
  Applications observer expected the old label `Applied`; the product displays
  `Submitted` for stored `applied` records. The exact visible label was corrected
  without changing product code, stored-status validation or expected rows.
- `ui-g-20261008-c`: four exact company/status rows passed on load/reload.
  Analytics showed Total=4 and Submitted=4, but its pie-chart legend also said
  Submitted. The observer now distinguishes the statistic value from chart text.
  All source/clone evidence integrity checks passed in these attempts. No agent
  execution, scoring, tailoring, submission or new application recording ran.
- **`ui-g-20261008-d` passed all ten rendered observations**, with
  `realAgent: not-run`, `modelCalls: 0`, `newApplications: 0`. Dashboard shows 4;
  Applications contains all four exact company/status rows; Analytics shows
  Total=4 and Submitted=4, each before/after reload. All four detail pages display
  the exact saved receipt reference. Cleanup and preservation checks passed.

Final UI evidence: `.temp/apply-e2e/ui-g-20261008-d/report.json`,
`evidence-after.json`, `source-inventories.json` and ten screenshots in `ui/`.
G's original report remains byte-identical at SHA256
`92e44b827dcaf90192302b457d95927d28ef29138d431e0c2b06a6419d1ff0aa`.
Its 50-table database fingerprint before and after is
`d8010bdccd9b7e48923e4c421cd4a4c1be022a76722e2c6e4340b5b3eadb5d41`.
All 25 original storage files and source metadata hashes are unchanged. Only the
new clone's synthetic password was reset before observation, and normal login
refresh-token writes were allowed afterward; all other table hashes matched.
Dedicated listeners were closed. The continuation remains paused, the baseline
commit remains the user's task, and no phase commit or new model run was made.

## Later model-free continuation

The user's later request to advance while Claude remains unavailable permits
independent implementation and deterministic checks. The heartbeat stays paused;
model execution and automatic acceptance retries remain disabled.

Phases 2–9 now have separate model-free evidence: queue dispatch and recovery,
question collection/Needs you, confirmed answer reuse, exact-document preparation,
immutable shadow-scoring reports, controlled concurrency, local Telegram behavior,
and the final Queue experience. Each phase report records its separate disposable
database/browser/UI gates and applicable migration checks. Failures are repaired
in their own layer and retain their prior reports. G's application workflow has
not been rerun.

The Phase 6 shadow runner also refuses before approval consumption because the
installed CLI's subscription-only context isolation remains unverified. Its fake
process tests do not count as a Sonnet/Haiku comparison. No model default changed,
and no provider probe, alternate OpenApply provider or paid API request was used.
Phase 7's fake-process, cap/lease and actual guest-browser isolation gates pass;
its live model acceptance remains unrun. Phase 8's local transport/database/UI
proof passes without contacting a bot. Phase 9 passes eight database groups and
17 rendered UI observations, including preserved exact PDF bytes, with zero
provider processes or model calls. UI failures exposed focus and read-rate
defects, both fixed without repeating scoring, tailoring or applications.

The final Phase 9 repository gate passes 1,410 API, 50 contract, 305 web, 424
terminal and 20 UI-harness tests. Production preparation remains disabled because
enforced subscription-provider tool/context isolation is still unverified. Its
scoped capability and fake executor are not live-provider acceptance. Every phase
retains its external/model acceptance requirements. See
`docs/apply-pipeline-phase-9-2026-10-08.md` for the final independent boundary and
remaining gates. No phase commit or baseline commit was made by this continuation.
