# Post-completion engineering audit and optimization

Started October 8, 2026. This is an audit and optimization initiative, not another
roadmap phase. Inspect the implemented system, fix concrete high-value defects,
and verify each change at the cheapest sufficient layer.

## Scope and baseline

- Review the API, web, terminal, plugin, persistence, background services,
  provider boundaries and development/test tooling as one system.
- Work in the attached `codex/apply-pipeline-queue` worktree at
  `C:/Users/7474g/.codex/worktrees/apply-pipeline-queue/OpenApply`. The original
  `D:/Dev/OpenApply` checkout does not yet contain the later implementation.
- Baseline HEAD: `18433567acd483a84ce321fcff29a0d13dc8799f`, with the completed
  model-free implementation preserved in `phase9-model-free-20261008` (1,147
  files and 29 deletions). Git HEAD alone does not identify this dirty baseline.
- Keep provider execution, quota probes, paid API routing, live acceptance,
  external messages, production data changes and commits disabled. Use existing
  evidence and deterministic checks. No database migration is planned.
- Independent gates through Phase 9 passed; live common-queue, scoring,
  concurrent-agent, Telegram and employer acceptance did not. Production
  preparation and shadow dispatch still have unresolved isolation gates.

## Outcome

The current implementation is materially more complete than the original checkout,
but **it is not yet demonstrated production-ready**. The audit found a common-queue
plugin preflight defect, a resume publication race, unsafe inherited database
settings in unit tests, and gaps between admitted work and available executors.
Bounded fixes improve correctness, observability and test efficiency. The remaining
live-execution gaps are documented rather than bypassed or declared passed.

The architecture map and ownership description are in [architecture.md](architecture.md).
The current executable testing contract is in [testing-tiers.md](testing-tiers.md).
Original phase reports and the [historical usage audit](claude-usage-efficiency-2026-10-08.md)
remain evidence, not instructions to repeat earlier campaigns.

## Evidence policy

Historical token/request counts are attributed to their original log scope.
Cache-token occurrences are not subscription quota percentages. No live latency,
quality or token-saving claim will be made from mocked execution. Deterministic
before/after counts and byte sizes will be labelled separately from projections.

## A. Actual architecture and audit coverage

Reviewed the approved apply-pipeline plan/amendments, phase 1–9 reports, handoffs,
historical usage and test reports against the API, terminal, plugin, web, contracts,
schema and test runners. This is a domain-wide source/contract audit with targeted
regressions, not an assertion that every line or deployment scenario was executed.

| Responsibility | Implemented owner and important boundary |
| --- | --- |
| Discovery, ingestion, deduplication | API `job-sources`, `job-listing`, `job-intakes`; public feeds and canonical URLs, optional user discovery keys; unresolved links stay unresolved |
| Fit and candidate matching | API `scoring` validates model-supplied original-source evidence and computes persisted fit/eligibility; source/context hashes govern reuse |
| Parsing, tailoring, PDF | Companion inference and plugin resume skills supply model work; API `resume` validates facts/structure, compiles and publishes byte-bound artifacts |
| Admission, scheduling, dispatch | API `work-queue` owns durable WorkItems, leases/reservations; companion `QueueRuntime` owns finite authorized processes; Pilot schedules into that queue |
| Navigation and form completion | Per-job plugin worker, isolated browser broker and exact lease; deterministic question collection/preparation are separate from reasoning |
| Submission and durable receipt | `application/submission-attempt.service.ts` guards begin/receipt; campaign job-result records canonical Application; process completion is not success |
| History, Analytics, dashboard | API canonical reads and web TanStack Query; SSE invalidation/refetch, application PDF downloads preserve exact artifact identity |
| Needs you and recovery | Current question/answer/document revisions, parked WorkItems and explicit unknown-submission recovery; no blind repeat of Submit |
| Authentication/persistence/workers | API account guards, PAT/scoped capabilities, PostgreSQL/Prisma, encrypted user credentials, filesystem artifacts and bounded background jobs |
| Companion/plugin/providers | Local .NET/WSL or Lima; interactive PTY separate from bounded queue; Claude/Codex configurations do not make all paths equally authorized |
| Testing/development | Separate unit, browser, disposable database and replay runners; historical full campaign is disabled pending common-queue redesign |

The queue is the single intended execution scheduler, but admission and execution
support are not symmetric. Chat is now a queue facade and Pilot has no independent
execution loop. Retained general preparation intents still lack a usable bounded
consumer. The interactive PTY remains a distinct manual tooling surface; API lease
checks block its use as an unguarded submission bypass. Do not describe these facts
as full autonomous discovery-to-submission acceptance.

## B. Prioritized findings

P1 means an evidenced correctness/safety defect or release blocker. P2 means a
material efficiency, observability or maintainability issue. No confirmed
credential disclosure was found; this review is not a penetration-test certificate.

| ID / severity | Evidence and impact | Resolution / implementation risk |
| --- | --- | --- |
| A1 / P1 | `QueueRuntime.cs`, `ChatModelBudget.cs`, shipped `plugin/agents/*.md`: finite budgets require worker maxTurns, but both shipped agents lack it. Claim/browser work preceded eventual rejection; fake installs hid the mismatch. | Fixed: bounded per-allocation plugin staging, finite caps, source/hash checks before approval/claim and again before launch. Medium risk; real shipped files tested with fake provider and three allocations. |
| A2 / P1 | `resume/variants/variant.service.ts`: evidence-free rewrite returned before base-version lock/check, allowing publication against an edited/deleted/transferred base after compilation. | Fixed: unconditional owned-base/version check in the publication transaction, conditional evidence lock only. Low risk; stale-source and artifact-cleanup tests. |
| A3 / P1 | `apps/api/scripts/test-env.ts`: nullish defaults retained real inherited/.env DATABASE_URL and service configuration during unit tests. | Fixed: forced dummy configuration and pg Client/Pool denial before sockets. Low risk; child-process inherited and dotenv-only scenarios prove isolation. Integration runners remain separate. |
| A4 / P1, open | `QueueModelGrant.cs`, `QueueRuntime.cs`, `work-queue.execution.ts`: campaign/search/inbox intents can enter the queue while runtime grants accept only application/intake_prepare. Intake model execution is itself disabled pending isolation. | Release-readiness gap. Do not expand grants or bypass scoped capabilities in this optimization audit. Requires a separately reviewed executor boundary. |
| A5 / P1, open | `plugin/bin/question-collector.mjs`, `worker-browser-core.mjs`: current common broker accepts reviewed ATS shapes and loopback, not arbitrary employer hosts. | Unfamiliar-layout fixture support is real but narrower than arbitrary-host support. Keep restrictions; design/review safe generic-host capability before claiming full coverage. |
| A6 / P2 | `scoring/original-source.ts`: repeated scoring-context reads reparsed identical PDF/DOCX bytes even with a reusable assessment. | Fixed: bounded hash/extension-keyed extraction cache and concurrent sharing; file reads/hash and ownership remain current. Low risk. |
| A7 / P2 | `analytics/analytics.service.ts`: queueDepth counted legacy Job.status queued, disagreeing with canonical WorkItems. | Fixed to account-owned queued WorkItems. Low risk; query assertions cover ownership and state. |
| A8 / P2 | `package.json`, CI: root Node testing named 17 of 56 files; CI omitted web/contracts/Node suites. | Fixed explicit 57-file inventory (one added inventory test), 46 local files plus 11 environment-bound exclusions; CI includes local suites. Low risk; inventory rejects drift. |
| A9 / P2 | `scripts/apply-e2e/processes.mjs`: runCommand timeout/overflow killed only direct child, unlike managed-process tree cleanup. | Fixed awaited owned-tree shutdown; three owned PIDs gone and unrelated sentinel retained. Medium platform risk; Windows executed, POSIX source-reviewed only. |
| A10 / P2 | `common/sse/broker.ts`: replay history was bounded, but every subscriber's pending mailbox grew without a limit. | Fixed 256-frame bound with slow-stream close/cleanup; healthy subscribers and reconnect history preserved. Low risk; does not claim byte/heap bounds or wire-level load testing. |
| A11 / P2 | `ClaudeUsageLedger.cs`: usage lacked execution/model/duration summaries; inference used unbounded output collection. Raw identity retention also lacked a practical byte bound. | Bounded metadata summaries, observed-vs-requested model, process outcome, capture bounds and identity handling. Metadata rejection must preserve already observed counters. No new database logging or sensitive payload retention. |
| A12 / P2 | `plugin/skills/apply/SKILL.md`: queue-only preamble followed by 12.9 KB instructions for an explicitly forbidden scoring/apply loop, including clearing campaign limits. | Removed contradictory loop; concise admission flow retains exact scope, current limits, authorization, idempotency and recovery. No replacement executor or weaker submission rules. |
| A13 / P2 | API CLAUDE_BIN setting/setup and README/deploy text implied a server LLM runner, but no API model launcher uses the setting. | Removed dead setting/defaults, corrected architecture/setup descriptions. Existing developer MVP browser observation is not hosted account isolation. |

## C. Claude consumption diagnosis

### Call paths and authentication

| Path | Actual model work / cost boundary |
| --- | --- |
| Development assistant | This Codex session's code reasoning and deterministic shell/tests do not invoke Claude. Explicit `claude` subprocesses during prior acceptance/probes did. Other Claude Desktop/Code sessions can share the account limit; their totals are not attributable to this audit. |
| Advanced PTY | `Providers/ClaudeProvider.cs` launches Claude Code with installed login/environment; skills, reasoning, browser tool choices, scoring, tailoring and reviewer subagents share that route. Ordinary PTY usage is outside queue grant accounting. Codex support exists but was not selected as a replacement. |
| Common queue | `Chat/ChatProcess.cs` launches bounded stream-JSON Claude; `QueueRuntime` gives one allocation an exact lease/job. Parent reasoning and score/apply/reviewer subagents are model calls, not free local orchestration. |
| Resume inference / readiness | `InferenceRunner.cs` uses existing Haiku default or requested Sonnet, three-turn/two-minute bounds. A missing-text/check request can perform actual generation; it is not a free quota probe. This audit changed no model default. |
| Gmail check | `Connectors/GmailCheckEndpoints.cs` contains a Claude path with eight-turn/90-second limits. Connector/version/hook inspection is distinct from generated checks. |
| Scoring / tailoring / answers | API scoring and resume services validate/store work but do not call a model. Plugin worker reasoning supplies scoring evidence, rewrites, review and form prose. Confirmed fact reuse and deterministic preparation do not require inference. |
| Retry / recovery | Resuming reasoning can spend again; reusing a receipt should only finish recording. Browser/UI/infrastructure retries must not launch another application worker. Historical `apply:e2e` and `scoring:shadow` remain disabled. |

Read-only local metadata at audit time showed a Claude OAuth credential with
subscription type `pro`; relevant API-key/auth-token/base-URL/cloud-routing variables
were absent from the inspecting shell. No credential values were printed. This
does **not** establish historical subprocess environment or account-wide billing.
Anthropic documents that Pro/Max Claude Code shares subscription limits with Claude,
while a configured Anthropic API key routes to separate API billing.
[Official authentication/billing guidance](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

No API credits, quota probe or provider call was used here. Provider token and
list-price metadata do not reveal a reliable Pro percentage or reset allowance;
context and tool traffic still matter even when cached.
[Official cost guidance](https://code.claude.com/docs/en/costs).

### Measured historical consumption

Source: preserved `D:/Dev/OpenApply/.temp/claude-usage-audit/measured-usage.json`.
These values were rechecked from that aggregate, not reconstructed by generating
new applications. Method: deduplicate message/request IDs, use maximum cumulative
fields across streamed blocks, exclude synthetic responses, and do not add final
result totals twice. Tool-result sizes count text characters, not image tokens.

| Campaign-log measure | Observed amount |
| --- | ---: |
| Unique provider request IDs, runs C/D/E/F/G/I | 760 |
| Uncached input tokens | 1,536 |
| Cache creation token occurrences | 2,452,822 |
| Cache read token occurrences | 61,760,641 |
| Recorded output tokens, incomplete lower bound | at least 77,256 |
| Tool calls / returned text characters | 908 / 3,080,757 |
| Requests by run C / D / E / F / G / I | 60 / 55 / 178 / 155 / 208 / 104 |
| Run G parent / scoring / application-worker requests | 27 / 11 / 170 |

G already passed all four jobs' application evidence assertions; its remaining
failure was rendering. H failed Windows cross-drive staging with no recorded model
session. I nevertheless spent 104 observed requests before its limit. Those 104
requests are a concrete example of avoidable re-execution after unrelated failure,
not a prediction of savings per future application. No run sessions in the aggregate
for A/B/H means no measured sessions there, not proof of zero account activity.

Three successful four-token readiness outputs carried roughly 44,000 input/cache
context tokens each; six additional companion readiness generations have no stored
usage envelopes. Two concurrent unrelated Opus sessions contained 149 requests and
are excluded. Output totals are partial; hidden HTTP/provider retries, image-token
costs, complete Claude Code/desktop totals and account-wide quota weighting are
unavailable. Cache reads are repeated token occurrences, not unique content or
quota units. List-price-equivalent dollars are not proven subscription charges.

### Root causes and cost priorities

1. **Verification coupling:** full application work ran again for rendering,
   infrastructure and staging failures. Reuse original passing evidence and route
   failures to their own deterministic/replay tier. This is the strongest evidenced
   unnecessary spending source.
2. **Long reasoning/tool loops:** G's application workers account for 170/208
   observed requests (about 82%). This includes navigation, form interpretation,
   tailoring and verification; it is not a clean per-stage token allocation.
3. **Repeated context and bulky outputs:** G returned 242,108 API-text characters,
   151,015 file-read characters and 89,601 browser-text characters. Browser output
   alone is not the dominant text source. Across runs, API/Bash/file guidance and
   inherited context accumulate; cached tokens still recur on subsequent requests.
4. **Model readiness checks:** short outputs can still load large context. Process,
   installation, database and browser health checks must stay deterministic.
5. **Redundant procedures and compute:** obsolete apply-loop guidance increases
   prompt volume and competing instructions; repeated original parsing wastes local
   CPU before a cached assessment can return. Both were reduced without weakening
   source validation.

No evidence supports removing final factual review, blindly caching dynamic DOM
snapshots, truncating the authoritative job description, or changing the default
model. Those would trade correctness for unmeasured savings. Browser guidance already
calls for narrow observations, cached stable context and compact worker handbacks.
Further browser/response-size work should follow measured stage telemetry.

## D. Implemented optimizations and safeguards

- **Queue staging and preflight:** exact per-allocation snapshots preserve agent
  bodies/models and stricter existing turn caps; malformed settings/headers, links,
  mutation or oversized trees fail before claims. Four invalid cases produced zero
  claims, browsers, provider starts or approval-latch consumption. Three fake
  allocations used separate capped copies with unchanged original source hashes.
- **Resume integrity and reuse:** post-compilation transaction checks prevent stale
  publication. The cache retains at most 32 pending/ready entries and 2 MiB of text;
  failed extraction evicts, oversized results remain uncached, unchanged concurrent
  reads share extraction. It never caches ownership or skips current byte hashes.
- **Usage observability:** queue JSONL records run/allocation/work/execution IDs,
  source plugin hash, requested/observed model, elapsed time, input/output/cache
  counters, subagent starts and stop outcome. Cumulative final totals act as a floor,
  not an extra charge. Missing/partial usage is explicit. Submission outcome remains
  unknown until joined to canonical API receipts; no false success inference.
- **Bounds:** finite grant limits remain mandatory; no automatic model retries.
  Ledgers cap at 5,000 events/2 MB plus a bounded stop summary. Inference output is
  capped at 2,000,000 stdout characters; discarded stderr at 64,000. Overflow stops
  and releases the process gate. Observed token stops can overshoot by an in-flight
  response and are not hard pre-spend subscription guarantees.
- **Cheaper safe verification:** unit database isolation, complete Node inventory,
  CI coverage and descendant-process cleanup remove reasons to reach for a model
  campaign. Replay runners already implemented before this audit remain the route
  for independent rendering; the audit did not claim their earlier creation as new.
- **Simplification:** apply is now admission-only; Analytics uses canonical queue
  ownership; obsolete API Claude configuration and misleading architecture text
  were removed. No broad framework or new dependency was introduced.

Granular browser/scoring/tailoring usage remains unavailable when the CLI emits only
aggregate envelopes. The ledger records work mode and request/subagent scopes; it
does not invent fine-grained stage attribution. Manual PTY and unwrapped inference
token accounting remain gaps. Per-run metadata is bounded, but historical run-directory
retention still needs an explicit operational policy rather than automatic deletion
of acceptance evidence.

## E. Measured comparisons

| Scenario | Before | After | What this proves |
| --- | ---: | ---: | --- |
| 100 unchanged original-source reads | 100 parser calls | 1 parser call, still 100 byte reads/hashes | 99% fewer parses in this deterministic scenario; no LLM savings claim |
| 20 concurrent identical source reads | 20 parser calls | 1 parser call, still 20 reads/hashes | Shared extraction, unchanged source checks |
| Admission skill UTF-8 bytes | 12,945 | 4,621 | 8,324 fewer bytes (64.3%); no measured token/latency percentage |
| Node files covered by normal local command | 17 of 56 | 46 local; all 57 classified | Broader model-free regression coverage; 11 explicit environment-bound files |
| Stalled synthetic SSE consumer, 10,000 publications | 10,000 frames retained/drainable | Closed at overflow; at most 256 pending, zero backlog drained afterward | Bounded queue behavior, not measured heap/CPU savings |
| Timeout/overflow cleanup | Direct child kill | 3 owned PIDs gone; unrelated sentinel alive | Owned descendant cleanup in executed Windows fixture |
| Shipped plugin under finite worker budget | Both shipped agents rejected | Valid bounded snapshots accepted in fake integration | Correct preflight/launch configuration, not live provider compatibility |

The integrated model-free gate took approximately 83 seconds in this worktree
(sum of recorded command wall times), including 187 local Node tests in 11.75 seconds.
There is no comparable pre-audit wall-time sample, so this is a reproducible baseline,
not a speedup claim. No real-agent before/after cost or latency experiment was run.

## F. Verification and evidence

Evidence is preserved under `.temp/post-completion-audit/`; terminal-specific
review/build logs are under `.temp/postcompletion-audit/runtime-20261008/`.
The final gate ran in repository-required order, then the web/local Node suites.

| Check | Result |
| --- | --- |
| Biome CI / knip | Passed |
| API / web typechecks | Passed |
| API unit tests | 1,440 passed, zero failures; 4,827 assertions |
| Contracts | 50 passed, zero failures |
| Web | 305 passed, zero failures |
| Terminal, initial integrated gate | 435 passed, zero failures/skips |
| Terminal, final affected-scope retest after independent review | 438 passed, zero failures/skips; 20 focused ledger tests also passed |
| Classified local Node tests | 187 passed, zero failures/skips |
| Managed terminal Release build | Passed, zero warnings/errors |
| Isolated rebuilt companion, zero budget | Passed four check groups; no provider command, model call, claim or database mutation; host stopped |
| Focused SSE | 6 passed / 25 assertions; integrated above |
| Focused resume/Analytics/cache | 53 passed / 350 assertions; integrated above |
| Inherited and dotenv-only API isolation | Passed; no database socket permitted |
| Native AOT | Not rerun: local Windows native linker unavailable; managed build is not AOT evidence |
| Chromium/guest-host, migrations, fresh DB/UI replay | Not executed in this audit; unchanged integration evidence was preserved |
| Live provider, readiness generation, targeted/full acceptance | Not executed; no authorization and technical gates remain |

Initial terminal preflight tests exposed five old fake installs missing settings and
agents. Fixtures were made valid; existing assertions were not weakened. Initial
failure logs remain. Independent review then identified a counter-loss edge case on
invalid model metadata and excessive raw identity retention; the affected ledger
was corrected and retested separately. Final affected-scope results are recorded
in the table above rather than rerunning unrelated layers.

The ledger retention regression uses three 500,000-character raw identities;
retained aliases are 72 characters and child IDs 64, with no raw IDs logged.
Both assistant-response and final-result invalid-label cases preserve 14 measured
tokens while still stopping. A separate admission-guidance review caught potential
whole-campaign resume from a one-URL request: apply and shared queue guidance now
require exact `jobIds` for subsets and distinguish review from application resume.
New campaign creation also retains `clientCampaignId` across an uncertain response,
independently from the later queue idempotency key. The existing API already supports
these safeguards; no new admission endpoint was added.

The zero-budget host used an isolated loopback port and deny-by-default API stub,
confirmed blocked entrypoints/presence without claims, and stopped cleanly. Its zero
counters describe that controlled harness path, not an operating-system-wide or
account-wide provider usage measurement. The ordinary companion service was not
restarted or reconfigured.

No commits, pushes, production mutations, migrations, provider changes, API purchases
or external communications were performed. The existing continuation stays paused.

## G. Remaining risks and worthwhile follow-up

1. **Release blockers first:** close A4/A5 and provider tool/context isolation with
   narrowly scoped design and deterministic tests. Then obtain explicit approval
   for targeted live behavior before rebuilding full common-queue acceptance.
   The current historical launcher cannot provide that proof.
2. **Durable correctness stays primary:** transactional and fake-browser tests are
   strong local evidence, not real-employer validation. Unknown submissions,
   checkpoint recovery, real ATS changes and source-upload integrity still require
   a small reviewed live case list when authorized. Never replay ambiguous outcomes.
3. **Measure before optimizing browser reasoning:** add stage attribution only where
   supported by real provider events; compare requests, elapsed time and verified
   outcomes on approved synthetic cases. Consider compact stable API projections
   before speculative screenshot/DOM caches. Revalidate live form state at Submit.
4. **Queue read efficiency:** `work-queue.read.ts` refreshes under user locks for
   multiple list/summary/detail reads; intake listing contains per-row lookups.
   Profile query counts/lock duration before batching. No production latency or
   query-volume claim was established, so no broad query rewrite was attempted.
5. **Historical fuzzy dedupe:** `scoring/applied-duplicates.ts` limits candidates to
   1,000 without a stable ordering. Exact identity protection remains, but older
   fuzzy matches may be missed. Use indexed/narrowed candidates if actual dataset
   size warrants it; do not weaken duplicate fences in pursuit of throughput.
6. **Operations:** in-process SSE/rate state, local artifact storage, backup/restore,
   shared deployment coordination and local metadata retention need explicit
   deployment validation. POSIX descendant cleanup and native AOT were not executed
   here. No claim of public production readiness is justified yet.
7. **Legacy surface:** advanced PTY, unused/general preparation intents and historical
   acceptance bodies still need clearly documented ownership. Keep working manual
   functionality; retire a path only when its replacement is available and verified.

Development can now validate local behavior through a broader deterministic gate
and reproduce downstream UI from preserved evidence without new applications.
Real application execution gains correct bounded startup, less repeated parsing,
shorter admission guidance and usable usage summaries. The amount of Claude Pro
saved in future operation remains unmeasured; the defensible historical opportunity
is preventing repeats like run I's 104 unnecessary observed requests.
