# Verification without unnecessary model execution

Current as of October 8, 2026. A failing layer should rerun only that layer.
Preserve original agent evidence and use a fresh observation/run ID. Never repeat
an ambiguous submission, relabel a replay as a fresh application, or create an
approval automatically.

## Tier 1: deterministic tests

No LLM calls. The normal contributor gate is:

```bash
bun run ci
bun run knip
bun --cwd=apps/api run typecheck
bun --cwd=apps/web run typecheck
bun run test
dotnet test -c Release
```

`bun run test` includes API, contracts, web and all classified local Node suites.
The [Node manifest](../scripts/node-tests/manifest.mjs) accounts for every test
file: 46 local files, 8 browser-dependent files and 3 guest-host files. Inventory
validation fails on missing, duplicate or unclassified files. Environment-bound
tests are explicitly excluded from the local group rather than silently treated
as executed. CI runs local Node, web and contracts tests in addition to API tests.

```bash
bun run test:node
bun run test:node:browser     # explicit installed Chromium/Playwright environment
bun run test:node:guest-host  # explicit WSL/Lima host and guest dependencies
```

API unit preload replaces inherited/.env secrets and database settings with dummy
values, disables service jobs, and rejects pg client/pool queries/connects before
sockets. Unit storage is isolated by process. Fake provider/process tests exercise
contracts without launching an actual model. This is not a machine-wide network
sandbox: new provider paths must use fakes and pass review before joining Tier 1.

Database integration commands are separate. Existing `queue:verify`,
`questions:verify`, `answers:verify`, `preparation:verify`, `scoring:verify`,
`concurrency:verify` and `telegram:verify` runners validate disposable provenance.
Use their documented database-only mode where supported. A successful unit suite
does not establish database migration or browser integration success. Never use
these commands against a non-throwaway database without specific approval.

Infrastructure has its own checks: `bun run apply:ui --check` for prerequisites,
and `apply:ui --infra-only --source-dir <verified-source> --run-id <fresh-id>` for
cloning, staging and API/web/browser transport. Neither requires a provider. The
isolated `scripts/queue-regression/zero-budget-host.mjs` checks the built companion
against a deny-by-default loopback API stub with no queue grants.

## Tier 2: recorded synthetic evidence and rendered UI

```bash
bun run apply:ui --source-dir <preserved-passing-synthetic-run> --run-id <fresh-id>
```

This validates the original report, protected database fingerprint, exact artifact
inventory and original application assertions before cloning into a new disposable
environment. It starts API/web and a dedicated browser, not the agent or ATS
submission server. It produces UI observations linked to the original evidence;
it does not create new verified submissions. The historical G report's four jobs,
191 application assertions and 8 aggregate assertions remain the original proof.

Later domain runners likewise support separate preserved-state `--ui-source`
paths; Queue experience uses a distinct `--seed-source` then `--ui-source` flow.
Synthetic seeds and simulated browser frames remain labelled as such. Assertions
against receipts/PDF hashes, ownership and source integrity must not be weakened
to make a rendering test pass. A UI failure reruns this tier only.

## Tier 3: targeted live-agent behavior

Requires explicit user approval, an isolated synthetic fixture, deterministic
preflight, exact immutable input/work scope, a one-use grant and finite request,
token, turn, subagent, time and list-price-equivalent budgets. Start with the
smallest changed behavior. Provider readiness generation also consumes a model
call and needs authorization under the current audit restrictions.

The current production preparation isolation gate remains closed. Passing
fake-process tests or receiving approval does not establish the missing technical
isolation. There is no sanctioned generic shortcut around it.

## Tier 4: full live acceptance

Run only after an approved scope change affecting end-to-end correctness or an
explicit request for that campaign, with named synthetic cases, passing lower-tier
preflight and no automatic retries. Preserve Greenhouse, Lever, Ashby and unfamiliar
layout cases plus every original evidence assertion.

`bun run apply:e2e` keeps only its `--check` preflight and otherwise refuses: its
dispatch body was removed with chat. It needs a separately reviewed common-queue
implementation and campaign-wide budgets before it can run again.
The audit did not reactivate it. No full campaign is authorized by a test failure,
a quota reset, a heartbeat, a copied grant file or this document.

## Failure routing and usage accounting

| Failure | Cheapest relevant next check |
| --- | --- |
| Type, API state, validation, extraction, PDF binding | Targeted unit/contract tests; disposable DB only if transaction semantics require it |
| Startup, cross-drive staging, timeout/cleanup | Local process and environment tests, then infrastructure-only clone |
| History, receipt download, dashboard or UI rendering | Verified evidence replay; no new application execution |
| Browser selectors, question readback, isolation | Explicit code-only Chromium/guest fixtures |
| New reasoning behavior | Approved Tier 3 only after deterministic checks |
| End-to-end submission behavior | Approved Tier 4 after targeted behavior passes |
| Begun/unknown submission | Inspect saved attempt/receipt; never automatic form retry |

Queue usage ledgers record metadata, not prompts, answers, credentials or raw tool
results. Requested and observed models differ; absent usage remains unavailable,
and final cumulative totals are not added twice. An observed request count is not
an HTTP retry count, account-wide spending meter or Claude Pro percentage. Join
execution IDs to canonical receipts to assess actual application outcomes.
