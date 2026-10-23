# Apply pipeline Phase 1 — October 8, 2026

Status: G retains passing evidence for all 191 application assertions and eight
aggregates. The separate model-free run `ui-g-20261008-d` now passes all ten
rendered UI observations against a verified disposable clone of G. Original
evidence, database and storage remain unchanged. This establishes the two
stages separately; it is not a fresh model run or a clean-checkout claim.
The phase commit still awaits the user's baseline commit. Phase 2 had not
started when this Phase 1 gate was recorded; subsequent phase reports document
the user's later model-free continuation. No phase commit or push has been made.
Model execution and automatic
continuation are suspended under the user's usage amendment; historical quota
reset/retry instructions below are superseded. See
`claude-usage-efficiency-2026-10-08.md` for measured usage, controls and limits.

The user approved the plan with five amendments during this phase: the user
commits the baseline first; minimal Queue and Needs you interfaces move into
Phases 2–3; fixtures must follow real ATS structures plus an unfamiliar layout;
non-throwaway database migrations require approval; and Pilot's Phase 2 role is
an optional scheduler feeding the common queue, with its separate execution
loop retired. The first three attempts below predate the four-fixture scope.

## Scope and baseline

The plan is in `.claude/plans/apply-pipeline.md`. Work is on
`codex/apply-pipeline`, created from `openapply/trim-and-reshape` with the existing
uncommitted work preserved. The current checkout contains substantial earlier
changes, so these results are not a clean-checkout reproducibility claim.

The handoff's last five-application trial documents zero verified submissions;
that does not prove a universal claim about every historical run. Its forced
Chat navigation and listed UI defects were already addressed in this chat; see
`ui-claims-verification-2026-10-08.md`. Dispatch still uses Chat until Phase 2.

## Implemented

- Four loopback-only fixtures: Greenhouse, Lever, and Ashby
  structures based on observed real forms, plus an unfamiliar wizard. They cover
  required/conditional fields, PDF upload, and durable receipts. See
  `ats-fixture-structure-2026-10-08.md` for sources and observed/test differences.
- Exact posted-field and PDF-byte evidence, request counts independent of receipt
  deduplication, and retained records across fixture restarts.
- A one-command runner that creates a synthetic account, original resume, and
  four queued jobs in a unique local guest database, then dispatches OpenApply's
  own agent through the existing workflow. The harness rejects direct writes to
  scoring, submission checkpoints, receipts, and successful application results.
- Separate API/web/companion processes, storage, and a headed browser profile.
  Validated plugin configuration selects its loopback CDP port and output path.
  The normal user's database, services, and browser are not test targets.
- Assertions for exact answers, original-source scoring, distinct tailored
  variants, uploaded/checkpoint/application PDF hashes, observed receipt
  identity, saved applications, aggregate totals, and authenticated rendered UI.
- `bun run test:apply-e2e`, `bun run apply:e2e --check`, and
  `bun run apply:e2e`, documented in `development.md`.

The synthetic applicant is both currently authorized to work in Canada and in
need of future sponsorship. The inverse sponsorship question must be answered
No. Why-us paragraphs are supplied synthetic answers derived from the invented
resume and fixture posting. Exact comparisons prove free-text fidelity; they do
not prove the factual accuracy of arbitrary generated prose.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run ci` | Passed, 1,149 files checked after the staging changes. |
| `bun run knip` | Passed. |
| API and web `typecheck` | Both passed. |
| `bun run test` | Latest rerun passed: 1,068 API, 50 contracts, 185 web, and 73 host harness tests; two guest-browser tests skipped on Windows. |
| `bun run test:apply-e2e` after the description correction | Passed: 66 host tests; two guest-browser tests skipped on Windows. |
| Guest Chromium fixture tests | Passed: both the origin regression and four-layout navigation/conditional-control tests. No final application submissions. |
| `dotnet test -c Release` with the installed SDK executable | Passed: 328 tests. |
| `bun run apply:e2e --check` with `OPENAPPLY_E2E_DOTNET` set | Passed read-only runtime preflight. No agent work. |

Local check logs are under `.temp/apply-pipeline-checks/`. Deterministic fixture
tests intentionally send HTTP submissions; those validate the fixture server
and never count as successful agent applications.

## Live attempts

### `phase1-20261008-a`

The isolated database migrations and API startup completed. The staged web copy
failed to start because Turbopack rejected a dependency symlink outside its
filesystem boundary. The harness timed out, stopped its owned services, and
recorded failure. Agent dispatch, scoring, tailoring, form filling, submission,
receipt verification, and rendered UI checks did not run.

Evidence: `.temp/apply-e2e/phase1-20261008-a/report.json` and `environment.json`.
The environment runner now uses the supported `--webpack` development mode and
reports startup stages and early process exits.

A separate read-only guest probe found BusyBox does not support `env --chdir`.
The browser launcher now uses a constant portable shell script with separate
positional arguments. Unit tests and a harmless guest probe verified literal
argument handling.

### `phase1-20261008-b`

The database, API, private web app, dedicated headed browser, fixture server, and
guest transport started. The companion exited before agent dispatch. A separate
credential-free diagnostic confirmed that the same companion build and
configuration can start. Starting the host companion before its guest forwarding
listener addresses the Windows/WSL localhost port collision.

Evidence: `.temp/apply-e2e/phase1-20261008-b/report.json` and
`environment-progress.json`. No agent application stages ran. Review also found
that guest shutdown needed to await fixture evidence writes, and host shutdown
needed to confirm process exit; those lifecycle fixes were applied and tested.

### `phase1-20261008-c`

The isolated stack and base-resume PDF compiler passed setup. OpenApply's own
agent scored all three jobs at 100 using the uploaded original, created a new
tailored variant for the Greenhouse-shaped case, filled its form, uploaded the
PDF, and saved a reviewed checkpoint. The checkpoint captured both authorization
and future sponsorship as Yes, the conditional explanation, and the exact
supplied why-us paragraph.

The agent clicked Submit once. The fixture rejected it with HTTP 403 because
its `Referrer-Policy: no-referrer` caused Chromium to send `Origin: null`, which
the fixture's strict origin guard rejected. A separate deterministic browser
header probe reproduced this behavior and confirmed that `same-origin` preserves
the expected origin. The response policy is now `same-origin`; the origin guard
still rejects null and foreign origins.

No receipt or application was recorded. The agent correctly left the attempt
`unknown`, parked the job in `needs_user`, and did not resubmit. The harness
cancelled the remaining work and preserved evidence. This run failed acceptance;
it did demonstrate the ambiguous-submission stop path.

Evidence: `.temp/apply-e2e/phase1-20261008-c/report.json`, including the persisted
checkpoint and failure evidence. Read-only viewing of the browser was a manual
observation; all application form actions were performed by OpenApply's agent.

### `phase1-20261008-d`

The expanded four-fixture run started successfully and the agent scored all
four jobs. It submitted the Greenhouse case once and recorded its receipt and
application. The runner then exited abruptly with code 9 while the next job was
being prepared. Its JavaScript cleanup/report path did not run; the cause has
not been established. This is an interrupted acceptance attempt, not a pass.

Read-only recovery preserved one fixture POST, one receipt, one application,
the submitted PDF, and the database records in `interrupted-observation.json`
and `interrupted-greenhouse-submitted.pdf` under the run's evidence directory.
The original `report.json` remains unchanged. The second job had no submission
attempt; the other two were pending. Rendered UI checks did not run.

Manual recovery inspected only this run's records and orphaned process
identities, then stopped the verified orphaned private processes. No form was
replayed or successful application written by the harness. Private process
lifecycle diagnostics and awaited progress persistence were added before a
fresh, isolated retry. Neither the process audit nor Windows event
inspection established why the runner exited.

Independent review strengthened assertions for saved application field values
and receipt text, real grounded text changes retained in the archived artifact,
exact canonical job identity, and final POST attempts rejected by Origin checks.
A separate read-only recheck of D's Greenhouse records passes 49 of 50 checks.
Worker-handback API revalidation was unavailable after the API stopped; this
recheck does not change D into a passing acceptance run.

### `phase1-20261008-e`

Started a fresh disposable database and four new fixture URLs after all updated
deterministic checks passed. This attempt is launched through a hidden local
PowerShell process invoking the same Node runner directly, with stdout, stderr,
launcher exit status, job progress, and owned-process lifecycle evidence saved
under its evidence directory. This manual launch difference removes the long
tool-session/Bun wrapper from this attempt; it does not establish that either
caused D's interruption. No other validation runs concurrently with the agent.

Result: failed on the full-job-description comparison for all four cases.
Every other per-case check passed, including exact posted and saved field
values, one final POST per case, four distinct genuinely rewritten variants,
matching uploaded/archived/saved PDF hashes, observed receipts, recorded
applications, and all four unchanged worker-handback API revalidations.
All eight aggregate checks passed. Authenticated Dashboard, Applications, and
Analytics passed both initial and reload observations; all four application
detail pages displayed their receipt references. Ten screenshots were saved.

The fixtures mixed a run-specific employer name in the header with the base
name in the description. The agent stored the complete description using the
run-specific name; this caused the exact full-text comparison to fail without
losing the posting's requirements. The fixture now uses one consistent name
throughout. A regression checks all four rendered descriptions against the
manifest. The comparison remains strict. E's original failed report is retained.

Evidence: `.temp/apply-e2e/phase1-20261008-e/report.json`, `progress.jsonl`,
`owned-processes.jsonl`, `launcher-result.json`, and `ui/`. The main assistant
only observed the fixture browser; OpenApply's agent performed every form action.

### `phase1-20261008-f`

The documented `bun run apply:e2e --run-id phase1-20261008-f --timeout-minutes 60`
command ran against another fresh disposable database with the consistent
fixture descriptions. A hidden PowerShell launcher keeps the long run separate
from tool-session lifetime and captures its exit code. Updated lint, unused-code,
66 host harness tests, and read-only preflight passed before dispatch. Two guest
browser tests remain separately verified; no concurrent validation runs during
the live campaign.

Result: the provider hit its session limit during the unfamiliar wizard, after
Greenhouse, Lever, and Ashby were each submitted exactly once and recorded with
receipts. The unfamiliar job had no submission attempt. The Chat run failed,
the harness preserved failure evidence and stopped its owned services, and the
launcher exited 1. Final four-case assertions and rendered UI checks did not run.

Read-only comparison of the preserved jobs confirms all four now contain the
complete expected description, including the run-specific company name. This
verifies the earlier fixture correction but does not turn this run into a full
acceptance pass. Post-run preflight confirms all dedicated ports are free and
the shared runtime remains idle. No submission was replayed.

Evidence: `.temp/apply-e2e/phase1-20261008-f/report.json`, `progress.jsonl`,
`owned-processes.jsonl`, and `launcher-result.json`. The final assistant message
reports the session limit and a 6:40 a.m. Toronto reset. Do not silently switch
providers/models or infer quota from successful authentication.

### `phase1-20261008-g`

A single Sonnet readiness probe succeeded after the reported reset. Read-only
runtime preflight and all 66 host harness tests passed. The documented command
ran through a hidden PowerShell launcher with a new run ID and another verified
disposable database, from 10:41 a.m. to 11:03 a.m. Toronto on October 8.

All four jobs completed through OpenApply's own agent. Every per-case assertion
passed (50 Greenhouse, 47 each for Lever, Ashby, and the unfamiliar wizard), as
did all eight aggregate checks. This includes the corrected complete posting
text, exact posted/saved answers, one final POST per fixture, four distinct
grounded variants, PDF identity, receipts, applications, and API revalidation of
the unchanged agent-reported worker handbacks.

Result: failed. The authenticated UI observer retained no successful page
observations. The agent separately reported a Next.js build error resolving
`@/components/features/workspace/application-history`. Read-only inspection
confirmed that the original source file exists but is absent from the staged
web workspace. Other web files and plugin helpers are also absent from that
copy. The private Next development log also records the missing root layout and
unresolved application-history and UI imports. A fresh copy probe retained all
source files with matching bytes; the existing copies had lost both unchanged
and modified files after successful startup. The responsible process remains
unknown. This does not invalidate the recorded application evidence, but it does
prevent a complete acceptance pass. The launcher exited 1 after owned-service
cleanup. No application was replayed and no successful result was manufactured.

Evidence: `.temp/apply-e2e/phase1-20261008-g/report.json`, `ui/observations.json`,
`progress.jsonl`, `owned-processes.jsonl`, and `launcher-result.json`. Review
limitations and agent-side upload workarounds are retained in the worker
handbacks; all four uploaded PDFs still passed the exact-byte identity checks.

### `phase1-20261008-h`

The owned web/plugin/companion workspace now uses a unique system-temp directory
outside the repository. Saved source inventories verify byte hashes after
copying, before dispatch, during polling, and before UI observation. Missing,
changed, or unexpected source files stop the run without silent replacement.
Environment files and generated web caches are excluded. This mitigates the
observed source-tree loss and detects recurrence; its external cause is not
claimed to be fixed. UI failures now retain a safe stage, route, HTTP status,
and error class without raw credential-bearing browser exceptions.

All full checks passed after these changes, followed by read-only preflight and
one successful Sonnet readiness probe. The documented command started at
11:14 a.m. Toronto on October 8 with a new run ID and disposable database.
Result: the relocated private web server did not pass its readiness check before
the deadline. The harness stopped its owned services and exited 1 at 11:17 a.m.
Agent dispatch and all application stages did not run. Diagnose this startup
failure with a model-free web probe before another full acceptance attempt.

Diagnosis: all staged web hashes remained intact. Next/Webpack generated invalid
`./D:/Dev/OpenApply/node_modules/...` client requests when resolving dependencies
from the C: temporary workspace. The runtime workspace now stays on the same
drive as its dependencies while remaining outside the checkout. The isolated
web-only probe returned `/login` HTTP 200 in 8.5 seconds, with no Next errors and
all 594 source hashes intact, then stopped its own process. No API, database, or
model work was needed for that probe.

### `phase1-20261008-i`

The same-drive regression and all 74 host harness tests passed, as did lint and
unused-code checks. The full API/contracts/web tests, typechecks, and 328 .NET
tests had passed before H; only fixture workspace selection changed afterward.
Read-only runtime preflight and one Sonnet readiness probe passed before I.
The documented command started at 11:24 a.m. Toronto on October 8 against a new
disposable database.

Result: Claude hit its session limit at 11:36 a.m., reporting a reset at
1:20 p.m. Toronto. Greenhouse and Lever were each submitted once and recorded.
Ashby and the unfamiliar job had no submission attempts. Source integrity and
runtime health checks passed during the run; no recurrence of the source-loss
or cross-drive startup failures was reported. Final four-case assertions and
rendered UI checks did not run. The harness retained the failure evidence,
stopped its owned services, and exited 1. No submission was replayed.

Read-only post-run verification confirmed all 594 web and 72 plugin source
hashes still match their saved inventories. All six owned processes exited;
their PIDs and the dedicated host listeners are gone. A 1:25 p.m. continuation
was scheduled at that time. It has since been paused under the user's usage
amendment; neither readiness probes nor model retries remain authorized.

Evidence: `.temp/apply-e2e/phase1-20261008-i/report.json`, source inventories,
`progress.jsonl`, `owned-processes.jsonl`, and `launcher-result.json`.

Evidence: `.temp/apply-e2e/phase1-20261008-h/report.json`, `environment.json`,
the saved source inventories, `owned-processes.jsonl`, and `launcher-result.json`.

## Next gate

Rendered verification is now complete in `ui-g-20261008-d`: ten observations,
zero model calls, no new applications, and passing evidence/cleanup checks.
The model-free path also diagnosed and fixed an API source-staging exclusion,
the observer's stale Applied label (current UI: Submitted), and an ambiguous
Analytics selector. See the usage report for A–D results and hashes. Final
checks: lint/knip, both typechecks, 1,068 API + 50 contract + 185 web tests,
95 host harness tests + both guest Chromium tests, and 382 terminal tests pass.
Managed companion build and isolated zero-budget host checks pass. Native AOT
publishing remains blocked by the absent Visual Studio C++ linker.

Wait for the user's baseline commit before preparing the Phase 1 commit and its
reproducible verification. Preserve G's original failed overall report and its
passed application assertions. No fresh provider probe or model campaign is
authorized; any later model test needs explicit approval, named cases and finite
budgets. Never replay ambiguous submissions. No real-employer applications
have been authorized or attempted in this phase.

The user will commit the baseline before the Phase 1 commit. Phase-owned files
are `scripts/apply-e2e/`, `plugin/bin/browser-options.mjs`, its test,
`plugin/bin/openapply-browser.mjs`, the root `package.json` script additions,
the `knip.jsonc` declaration of the guest-installed Chromium binary,
`docs/development.md`, the two new phase/structure reports, and
`.claude/plans/apply-pipeline.md`. The usage amendment additionally owns the new
companion budget/ledger controls and their tests, isolated-host safeguards,
and the usage-efficiency report. Existing unrelated changes remain unstaged.
