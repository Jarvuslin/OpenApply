# Workday account setup: implementation and readiness

Historical report. Current implementation and integration status are recorded in
[Account queue integration](account-queue-integration-2026-10-09.md). The observations
below are preserved as evidence of the earlier blocked preflight.

Status: **partial implementation; live account creation is blocked before dispatch**.
This report does not claim an unattended signup or Gmail verification passed.

## Latest authorized trial: preflight blocked

After the separate Gmail diagnostic, the user authorized one autonomous Alcoa Workday signup
with `jarvis.lin74@gmail.com` and the previously supplied signup password. No password was
transmitted or written to this report. The requested live trial was **not launched**:

- Current source still returns `account_isolation_unsupported`; there is no account-only
  executor to dispatch. A model-free call confirmed the current worker URL predicate rejects
  `https://alcoa.wd5.myworkdayjobs.com/careers`.
- The active browser tool's confirmation policy requires user handoff before a new credential
  is entered, including its confirmation and submission, and action-time confirmation for
  accepting legally binding terms. Routing the same browser operation through another agent
  or subprocess cannot remove these requirements.
- Read-only browser inventory found no remaining tab in the previously selected in-app
  browser. No page was opened or form altered during this preflight.
- This preflight made zero Claude calls, Gmail searches, signup submissions, database changes
  or migrations. No retry was consumed or scheduled.

The preceding [Gmail diagnostic](gmail-code-diagnostic-2026-10-09.md) did prove one bounded
Claude Gmail search works. It returned no matching Alcoa verification mail; body reading and
fresh code extraction remain untested. Missing Gmail profile lookup is not the current blocker.
This preflight result must not be described as an attempted or failed autonomous signup.

## Later clarification: user-confirmed verification mailbox

The user accepted explicitly confirming the Gmail address connected to Claude for employer
verification. Missing profile lookup is therefore no longer a blocker for this narrow task.
The current `get-code` skill accepts that confirmation when no profile tool exists, reads
only request-scoped verification mail directly through the worker's connector, and preserves
exact recipient, expected sender, employer tenant, request-time and ambiguity checks. An
available profile mismatch or authorization failure still stops the lookup. It neither imports
mail nor marks the mailbox provider-verified. Saved row fields alone are not confirmation.

The readiness endpoint now reports `gmailProfileRequired:false` and unverified **worker access**,
rather than treating profile absence as an unconditional blocker. The historical preflight JSON
below is preserved unchanged and predates this clarification. Account-only browser isolation
and actual-worker search/read testing remain incomplete. No real code retrieval has been tested.
The earlier profile-only requirement described below is superseded for `get-code` only; general
mail imports and sending retain their existing requirements.

Validation after this clarification: independent instruction review completed, the full terminal
suite passed 460 tests with zero skips, Biome passed (13 existing informational suggestions),
and a new managed Release build passed with zero warnings/errors. Its isolated zero-request
host returned healthy and `gmailProfileRequired:false`; account readiness remained false for
the unsupported account executor and untested worker search/read access. The host was stopped
and port closure verified. Evidence is
`.temp/full-workflow-20261008/user-confirmed-mailbox-preflight-acea43aa-d85c-4528-b687-ea7a4159f0d9.json`.
These tests validate the instructions' consistency and readiness response, not live code
retrieval. No Claude inference, mailbox lookup, signup, migration or normal-app restart ran.

## Changes completed

- Added an explicit `account_setup` queue intent with no job, campaign, application or resume
  scope. Its immutable snapshot binds the exact employer origin, owned credential, email and
  one permitted signup attempt. The credential must match the exact tenant hostname; default,
  broader and different-employer credentials are rejected. Passwords stay outside snapshots,
  instructions and events. The internal credential response is marked `no-store`.
- A scoped account token cannot authenticate to ordinary API routes. Claiming requires both
  an explicit account runtime capability and the matching snapshot hash. The current application
  companion cannot accidentally claim this work as an application.
- Signup begin consumes its durable attempt before mutation. Another begin, a new enqueue key
  for the same tenant/email, or retry/resume after execution cannot repeat signup. Outcomes are
  a bounded enum; unresolved attempts need attention. This does not create application receipts.
- Independent review caught missing credential tenant binding and a trailing-dot hostname alias
  that could bypass duplicate identity. Both were corrected and covered by regressions.
- Added `GET /queue/account-setup/readiness`. It reports current missing capabilities without
  calling any provider, checking mail or trusting caller-supplied readiness flags. Saved email
  settings and another chat's connector cannot satisfy worker identity verification.
- Moved the queue's model launch marker after successful browser startup. A regression first
  failed because browser startup produced a launch marker with zero provider starts. It now
  passes and still proves the original approval remains consumed, preventing automatic replay.
  A launch marker remains a launch authorization, not a provider request/token measurement.
- Added tool discovery and exact inherited Claude Gmail read-tool grants to `job-worker.md`.
  These grants do not create tools missing from the upstream connector and do not verify access.

The new Prisma enum migration is **source only**. It was not applied to any database.
Prisma code generation used an unreachable dummy database URL and made no database connection.

## Verification

| Check | Result |
| --- | --- |
| Final account API unit regressions | 12 passed, 147 assertions |
| Full API suite before the final two scope corrections | 1,463 passed, 5,055 assertions |
| Contracts | 50 passed, 183 assertions |
| API and web typechecks | Passed; API repeated after final scope corrections |
| Repository Biome and Knip | Passed; final account files also checked after corrections |
| Full terminal suite after launch-marker correction | 460 passed, 0 skipped |
| Managed Release rebuild after correction | Passed, 0 warnings/errors |
| Isolated rebuilt companion health | Passed on port 14102, zero-request model budget |
| Readiness endpoint | Correctly blocked; no provider invocation |
| Cleanup | Owned test host stopped, port 14102 closed |
| Live account/verification flow | Not run |

The current host result is preserved at
`.temp/full-workflow-20261008/account-runtime-preflight-f4ae5a78-176d-46be-a3b9-86b383b519bb.json`.
It records the binary hash, disabled model budget, disconnected/idle queue, explicit blockers
and cleanup. It is model-free runtime evidence, not agent acceptance evidence. The earlier
failed application acceptance and its successful synthetic submission remain untouched.

## Remaining blockers and next implementation boundary

1. **The account-only worker is not implemented.** The existing worker exposes general
   application browser controls; releasing its preparation fence permits normal application
   actions. The new API and readiness endpoint do not supply browser/tool isolation. Workday
   is still rejected by the current question-collection/preparation URL policy. Broadening
   that allowlist alone would not solve this. A dedicated account operation must enforce the
   approved tenant and one signup mutation without job submission, upload, raw CDP, arbitrary
   shell or general browser controls. It must be validated with a synthetic account fixture.
2. **Fresh authenticated Gmail identity is unavailable/unverified inside the actual worker.**
   The standard connector's documented tool set includes search and message/thread reads but
   no account-profile operation. Its search success cannot establish the signed-in address.
   Current tool availability was not freshly queried through an inference call. The separate
   Codex-chat profile check cannot be forwarded as worker proof. The current identity requirement
   remains in force; reconnecting the same tool set does not supply the missing operation.
3. The normal app still runs the older checkout/companion. Only the isolated rebuilt host was
   started here. The account enum migration and coordinated app/runtime activation remain
   unperformed. Any non-throwaway migration requires the user's approval.

For the Gmail gap, a supported identity-capable connection in the worker is needed. The legacy
direct-Gmail OAuth implementation can obtain authenticated identity during consent, but it
requires a configured user OAuth client and integration into this scoped worker. It is not
currently a ready alternative in the connector-only settings flow. No tokens were extracted,
no OAuth client was created, and the provider was not switched.

The account-only flow also needs to preserve actual runtime requirements for new credentials
and site terms. This desktop browser's handoff/confirmation rules are not bypassed through a
subprocess or another agent. No manual form work was performed during this change.

Reference: the [official Claude Gmail connector tool list](https://claude.com/marketplace/connectors/gmail)
and [Google's Gmail search tool schema](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/search_threads)
were checked on October 9. Search results identify mail, not authenticated account identity.

## Consumption and scope

Zero Claude/model calls, signup requests, verification requests, mailbox calls, paid API credits,
provider switches or database migrations occurred in this change. No production user data was
modified and nothing was committed or pushed. The test host was closed; the normal app remained
running unchanged. This work improves early diagnosis and attempt ownership; it does not yet
establish lower live signup token consumption or a successful real account workflow.
