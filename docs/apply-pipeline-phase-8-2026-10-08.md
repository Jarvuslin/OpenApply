# Phase 8: Telegram as a second channel

Prepared October 8, 2026 after the independent Phase 7 gate. Snapshot
`phase7-model-free-20261008` preserves 1,014 files and 29 deletions at baseline
`18433567acd483a84ce321fcff29a0d13dc8799f`. The user's baseline commit is pending.

## Approach and scope

Use code-only parsing and safe templates over the common queue, question and
approval records. Pairing must prove an authenticated web account and a private
Telegram sender. Unlinking revokes outstanding actions. A delivery never proves
an application outcome or authorizes model spending.

In: channel-neutral link preparation/decisions, company exclusions and Undo,
checkpoint-bound human approvals, runtime presence, pairing, idempotent inbound
updates/buttons, bounded durable delivery, digests, Settings/Needs-you controls,
and disposable local verification. Out: bot creation, token acquisition, real
Telegram requests/messages, provider execution, server-side models, credits,
normal-database migrations, and automatic acceptance campaigns.

## Plan

- [x] Add durable domain and Telegram records with explicit migration constraints.
- [x] Resolve supported links into owned pending candidates without authorizing application.
- [x] Apply revisioned company exclusions and Undo through shared admission fences.
- [x] Bind trusted human decisions to exact questions and submission checkpoints.
- [x] Report runtime presence independently of model grants and job leases.
- [x] Implement private pairing, fixed intents, replay-safe buttons and safe templates.
- [x] Deliver through a bounded outbox; preserve unknown send outcomes without replay.
- [x] Add Settings pairing/notifications and canonical Needs-you approval controls.
- [x] Verify migration, database, fake transport, rendered UI and repository gates.
- [x] Record unrun external/model acceptance and continue independently to Phase 9.

## Product decisions

Apply now requests the next eligible application; Add to queue uses normal order.
Both use the common queue, limits and separate local model approval. Sending a
link alone authorizes preparation only. Saved fit/questions may be shown; missing
model scoring remains pending and is never invented. Telegram-intake applications
require a human approval bound to the current reviewed checkpoint before Submit.

The webhook creates verified `telegram_user` provenance internally from a live
linked sender. It never impersonates `session_user`, accepts user IDs as authority,
or treats agent output as confirmed human facts. Pairing itself requires a web
session. Sensitive and unknown questions link to authenticated web; safe fields
use a positive allowlist rather than category exclusions.

Supported text uses an anchored grammar: help/status/unlink, one HTTPS job link,
targeted answer/approve/skip/Undo tokens, and exact known-company exclusion phrases.
Ambiguous or mixed text receives help without mutation. A company rule changes
structured policy with confirmation and revision-bound Undo, never raw prompts.

Unknown presence means waiting for the computer; a recent heartbeat with execution
disabled is distinct from online-and-ready. Telegram delivery defaults disabled.
No credentials, pairing codes, sensitive answers or raw webhook bodies belong in
logs, reports or ordinary notifications.

## Interfaces and ownership

Domain routes: `/job-intakes` plus owned read/decision; `/application-rules` plus
revision-bound change Undo; `/runtime/presence`; canonical checkpoint decisions
through `/pilot/questions/:id/decision`. Existing question answer routes retain
their exact request ID, revision, definition hash and typed values.

Telegram routes: authenticated `/telegram` status/unlink, `/telegram/pairing`
creation/cancellation, `/telegram/settings`, and a separately secret-verified
`/telegram/webhook`. Status never exposes sender/chat IDs or the bot token. Raw
pairing material is returned once to its web creator; only a hash is persisted.

API/domain worker owns existing service/schema/auth integration and shared route
registration. Telegram worker owns new transport modules/contracts/schema and
tests, plus coordinated terminal presence integration. Root owns Settings,
canonical approval UI, the rendered observer, disposable database/migration
harnesses, orchestration and this report. A separate reviewer audits invariants
and adds focused tests.

## Verified transport constraints

Telegram documents private start links with bounded base64url parameters and a
secret webhook header. Inbound updates and callback identities require persistent
deduplication. The documented `sendMessage` parameters have no idempotency key;
the outbox therefore marks timeouts or crashes after dispatch as unknown and does
not automatically send again. These are design conclusions from the
[Bot API](https://core.telegram.org/bots/api#sendmessage) and
[deep-link documentation](https://core.telegram.org/bots/features#deep-linking).

Local fake transport can prove parsing, ownership, replay and failure behavior.
Actual test-bot delivery remains an external gate requiring explicit approval.

## Disposable migration verification

`phase8-migration-20261008-a` passed on fresh verified database
`apply_e2e_2b68fc1010d5`, in the reviewed guest cluster. It deploys 66 baseline
migrations, seeds synthetic legacy work, then applies only the frozen Phase 8
migration. Seven assertion groups pass; all columns and rows in 65 legacy tables
remain unchanged, including historical scores, application receipts, an ambiguous
submission, and agent versus human answer provenance. New settings default to
disabled delivery preferences; no links, actions, intakes or availability are
invented. Invalid pairing, settings, link ownership, attempt limits and consumed
approval shapes are rejected by the database. Constraint probes roll back.

Migration SHA-256:
`0dc890f3929e8a323d92583e255d9badfbb302f5bfb2bf433ed9a208ac2650f7`.
Evidence: `.temp/telegram-regression/phase8-migration-20261008-a/report.json`.
The bridge is closed and the disposable evidence database is retained. No normal
database was migrated, and no provider or Telegram request was made.

The initial combined database run, `telegram-db-20261008-a`, passed five groups
then exposed an old human-confirmation constraint that still accepted only
`session_user`. The new `telegram_user` answer correctly reached canonical storage
but was rejected by PostgreSQL (`P2039` at the Prisma boundary). The first migration
result above is preserved, but its hash is superseded once those legacy constraints
are explicitly extended to both trusted human channels. Agent confirmation must
remain forbidden. No model or application workflow was run to diagnose this issue.

Corrected migration `phase8-migration-20261008-b` passes on fresh database
`apply_e2e_d00c9cca7764`, with nine assertion groups and the same 65-table legacy
preservation check. Additional probes accept Telegram-authored human confirmation,
answer reuse and document selection while rejecting agent consent for all three.
All probes roll back, and the bridge is closed. The current migration hash is
`3a1b6d685af0ec46c0925fe0f4825016cdff3300fcd59beedfea7bd8e4523c6c`.

## Local checks completed so far

The web type check and all 246 web tests pass (669 assertions across 57 files) in
`.temp/telegram-regression/web-checks-20261008-a/`. Ten selected Node guards pass,
covering the exact local UI request allowlist, denial of provider/claim/webhook
requests, preservation boundaries, and clearing inherited Telegram configuration.
The rendered UI is still a separate pending gate.

The rebuilt Release companion passes 413 managed tests. The isolated 14103 check
in `.temp/queue-regression/phase8-terminal-zero-20261008-a/report.json` passes with
two authentication reads and blocked/stopped presence heartbeats only. It records
zero claims, model/provider launches or database mutations against its fake API;
the owned host is confirmed stopped. Normal companion 4102 is untouched.

Review corrected a PostgreSQL NULL check loophole for consumed approvals, stale
approval cancellation, targeted links hidden by pagination, and the web review
link. The approval card now renders the retained answers and an API-origin PDF
link, and requires the immutable checkpoint ID to match before review can be
confirmed. Lost acknowledgements retain the exact request identity for manual
retry. They do not start another campaign or model run.

## Remaining implementation and acceptance boundaries

Direct supported ATS links and known employer mappings resolve in code. An
unindexed employer page currently remains unresolved with Apply/Add disabled;
a general employer-page-to-ATS browser resolver is not implemented. Existing
finite model grants authorize application work only. `intake_prepare` work must
not borrow that grant or launch a provider implicitly; its model execution path
remains a technical limitation until a separately bounded handler is implemented.
These are implementation gaps, not evidence of successful live preparation.

Apply now also stores queue priority correctly, but the companion currently rotates
its previously granted exact work IDs without refreshing their relative priority.
It must never broaden that grant or bypass caps. Refreshing priority within that
approved set is additional Phase 9 work.

Actual test-bot delivery, live model preparation/application and real employers
remain unrun. Full Phase 8 acceptance cannot be claimed from local fake transport.

## Preserved database and rendered UI evidence

`telegram-db-20261008-b` passes all 16 groups on
`apply_e2e_5b3beb4066f3`. This includes owner/generation provenance, intake dedupe
and historical submission guards, current fit/provider/decision requirements,
company exclusions and Undo, checkpoint expiry/invalidation/one-use consumption,
saved answers and exact documents, runtime presence, canonical URL aliases,
and durable private pairing/inbound/outbox behavior. Three transport calls used
an injected fake. The verifier's throwing fetch guard records zero external
requests; model, provider and employer activity are zero.

UI A reached linked-status recovery, then stopped because the observer looked for
a checkbox instead of MUI's switch role. UI B exited during local API/web startup
without a final report; the cause is unknown. Its recorded owned processes and
host listeners were confirmed absent. The runner now persists its initial report
and UI-stage boundary so a process interruption retains a useful last state.
Neither failure authorized a database-suite or application replay.

`telegram-ui-20261008-c` passes ten observations on new clone
`apply_e2e_2077111f4ce6`, with zero migrations/models/provider launches/external
messages/employer submissions. It verifies read-error recovery, stale settings,
lost acknowledgement, explicit manual retry, unlink/private pairing/cancellation,
unready provider-free intake, exact checkpoint review, stale approval rejection,
and canonical Needs-you resolution. All three settings attempts reuse one request
ID and create one revision; both approval attempts reuse one ID. The source and
protected clone records remain intact, and the bridge closes. Screenshots were
inspected; private pairing material and inputs are masked.

Evidence directories are under `.temp/telegram-regression/` with the run IDs above.
Preserved database hash:
`b25bd4a6b80dc62d69a22d7b15186b412a87057c91e43f74dc58d118771be2b7`.
Storage hash:
`12f46197709dcc4243bf4bafa6c75bbf490cbd603023b697d2eb9dacdfad0883`.
Source report hash:
`cf9014e8d905fa21fc56046a5c3c816b789359e3acab6f4bfb6bdf807570dd31`.

## Repository gate and final review

Early attempts stopped at formatting/import order and unused exports. The next
found an old MVP queue fake missing the new intake query; the fake now models
owner, original/canonical URL and decision state, rejects unknown SQL, and has
explicit blocked/allowed/foreign-owner cases. Production admission was unchanged.

`final-gate-e` passes CI, knip, both type checks, 1,390 API tests (4,446 assertions),
and 50 contract tests (183 assertions). Its terminal step finds one Windows
fixture-file sharing race while checking process cancellation; 412 tests pass.
The fix must retain the parent-and-child termination assertions. Separately, all
246 web tests pass (669 assertions), and the selected harness suites pass 133
tests with three guest-only cases skipped on Windows. Their earlier actual guest
evidence is retained.

The Windows fixture now publishes its two PID values by same-directory rename
after closing the writer. Parent and child termination assertions are preserved.
The corrected terminal suite passes all 413 tests.

Independent web review then found cross-candidate retry state and unbounded
mutation acknowledgements. Intake state now resets for the account and candidate;
pending requests explicitly bind both identities while preserving the original
revision/provider on a retry. Channel mutations have a 15-second deadline through
headers, body and session recovery, and are never automatically resent. Pairing
state resets on account changes. Read failures describe application state as
unknown rather than asserting that nothing started.

`telegram-ui-20261008-d` passes ten observations on clone
`apply_e2e_7025808b9c27`. It withholds a committed settings acknowledgement beyond
the client deadline and proves manual retry uses the same ID and one revision.
It compares every saved settings field and fetches the retained PDF, checks its
header and size bound, and verifies its SHA-256 against the exact checkpoint.
The stale-decision check is labelled precisely; generic-answer refusal is proven
in the separate database group. Source/clone integrity and bridge cleanup pass.
Other links and their actions/deliveries are protected by the clone fingerprint.
Settings, setting requests and pairings are mutable only within the synthetic UI
account; this does not claim row-level historical isolation inside those three
fixture-account tables. Inputs and pairing material remain masked in screenshots.

The final ordered gate, `.temp/telegram-regression/final-gate-f/`, passes:

| Check | Result |
| --- | --- |
| CI and knip | Pass; existing informational template/configuration hints only |
| API and web type checks | Both pass |
| API tests | 1,390 pass; 4,446 assertions |
| Contract tests | 50 pass; 183 assertions |
| Managed Release terminal tests | 413 pass; zero skipped |
| Web tests | 261 pass; 701 assertions across 59 files |
| Selected Node harness suites | 133 pass; three existing guest-only skips |

The final five Telegram harness guard tests also pass after strengthened integrity
and PDF assertions. The independent Phase 8 gate is complete. The next allowed
step is model-free Phase 9 implementation, including the technical preparation
and priority gaps identified above. Live bot/model/employer acceptance remains
unrun, the heartbeat remains paused, and the user's baseline commit is pending.
No stage, commit, push, provider probe or paid API request occurred.
