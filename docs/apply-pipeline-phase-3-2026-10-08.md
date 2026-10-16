# Phase 3: question collection and Needs-you

Prepared October 8, 2026. Work is in the attached `codex/apply-pipeline-queue`
worktree. Implementation and the deterministic Phase 3 gate passed. No provider calls, model campaign,
normal database migration or employer application is authorized or required for
this phase's deterministic checks.

## Plan

Collect available form definitions with bounded code and store immutable question
revisions. Let the user answer those exact revisions in one Needs-you list while
the companion is offline. Keep observations distinct from submission permission.

- [x] Add owned, versioned question collections and confirmed typed answers.
- [x] Collect public Greenhouse definitions; report Lever/Ashby API limitations.
- [x] Inspect remaining form controls with a fixed, code-only browser collector.
- [x] Preserve incomplete/conditional observations without inventing requirements.
- [x] Show one paginated Needs-you list and an exact server count.
- [x] Resume work only after its applicable blockers are safely resolved.
- [x] Verify revisions, ownership, migration, browser fixtures and rendered UI.
- [x] Record deterministic results and outstanding model/external gates separately.

## Public API findings

Checked October 8, 2026 against official documentation. Greenhouse's public
`questions=true` endpoint exposes question groups, fields, options and requiredness.
Some required groups accept alternatives, such as resume upload or text. Preserve
that grouping instead of requiring every alternative. Demographic options can
require free text; a universal conditional-expression schema is not documented.
[Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html#retrieve-a-job).

Lever's public Postings API does not expose custom application questions. Its
hosted form therefore needs code-only inspection.
[Lever Postings API](https://github.com/lever/postings-api).

Ashby's public posting feed supplies job metadata and application URLs, not question
definitions. Its richer `jobPosting.info` endpoint requires employer `jobsRead`
credentials; this implementation does not create or use those credentials.
[Public feed](https://developers.ashbyhq.com/docs/public-job-posting-api),
[jobPosting.info](https://developers.ashbyhq.com/reference/jobpostinginfo),
[authentication](https://developers.ashbyhq.com/reference/authentication).

## Verification boundary

Synthetic collector and answer fixtures establish deterministic behavior only.
They do not establish that an agent applied to a job or that an arbitrary employer
form is complete. Unknown branches remain explicitly incomplete. A
collection cannot authorize submission or bypass the existing lease, factual
checkpoint, resume artifact, duplicate-attempt and receipt safeguards.

Phase 1 G evidence remains untouched. No new model acceptance or phase commit is
claimed; the baseline commit remains the user's responsibility.

## Evidence

The migration regression `phase3-migration-20261008-b` passes all six verification
groups. It created and verified `apply_e2e_bb3a9215db2c` in the isolated guest cluster,
deployed 61 earlier migrations, seeded two synthetic users, three jobs and eight
legacy questions plus two actual paused/needs-user queue records, then applied
`20261008210000_application_questions`.
Four owned ordinary questions became versioned observations. Historical answers
remain unconfirmed; OTP, approval, foreign and unknown references remain operational.
Protected records and ambiguous submission bytes stayed unchanged. The database
rejects promoting a migration-authored answer to human-confirmed status.

Evidence: `.temp/questions-regression/phase3-migration-20261008-b/report.json`.
The disposable database is retained and bridge 15434 is closed. Migration SHA-256:
`e258c62a93822aa379114f2961d26a474d2ce9f2a3c4b392e2b9448dfa845e58`.
This run made zero model calls and no employer submissions.

Four guest browser tests pass against the four Phase 1 form layouts plus hostile,
custom and unlabeled controls. Hidden conditions remain partial, unsafe requests
are blocked, and another job's redirect target is never requested. Two real helper
subprocess tests verify the streaming request/lifetime protocol, including cancellation
of an in-flight guest browser. No application form was submitted.

The real companion check `phase3-host-20261008-b` passes five groups under a
zero-request budget. It made three synthetic API GETs and one observation PUT;
only one guest GET reached the form. Busy, stale and authentication failures did
not launch another browser collection. Queue/model entrypoints remained blocked.
The isolated host, guest fixture and fake API stopped; normal port 4102 was untouched.

The real database run `questions-20261008-b` passes 12 groups, including concurrent
idempotency, changed revisions, stale/foreign/agent answers, partial retention,
conditional activation and completion, early-answer races, manual-resume refusal,
and exact pagination over 206 attention items. Database `apply_e2e_cde882b55dfe`
remains preserved with fingerprint
`4cb766712959ab0328d56ec9d35555b433efd42e9564f427b2a0cd43081648b1`.

The separate UI run `questions-ui-20261008-c` passes nine observations on clone
`apply_e2e_b69c69172ffa`: read-error recovery, unified count/list, stale revision
review, partial blocker retention, retry preserving its request ID, a hidden known
conditional answer offline, safe queue release, operational answering and persistence
after reload. It recorded five intentional answer requests, no Chat navigation and
zero runtime errors. Source report/database fingerprints stayed unchanged and owned
processes stopped. Screenshots and source inventories are retained alongside each run.

UI attempts A and B remain recorded. A exposed an overly broad harness classification
of Next's local stack-mapping request. B exposed a real hydration mismatch: a sidebar
query populated the client count cache before the streamed page hydrated. The page and
badge now use stable initial markup, with a regression comparing empty and primed
caches. C passed after those fixes. These retries cloned synthetic evidence only;
they did not repeat a model campaign, migrations, or application submissions.

Final repository checks pass: Biome (1,242 files), Knip, API/web typechecks, 1,137 API
tests, 50 contract tests, 212 web tests, and 355 .NET tests. Harness unit tests pass
96 with two guest-only skips on Windows; the guest collector suite was separately run.
Queue/helper guards pass seven; question/UI guards pass five. Native AOT publishing
still lacks the previously reported Visual Studio C++ linker; managed Release passes.

## Continuing limits

Definitions remain observations, with immutable revisions and append-only confirmed
answers. Identical recollection preserves existing answers and checkpoint timestamps;
semantic changes invalidate them. Public fetches are bounded credential-free GETs
with no redirect following or retries. Browser inspection permits only the owned
ATS job identity, validates every redirect hop, excludes saved answer values, and
holds the shared local gate through cleanup. No ATS application request was made.

File-only questions, unsupported free-text option semantics and unresolved dynamic
forms remain visible blockers. They cannot be cleared by a pretend filename or by
calling incomplete coverage complete. Phase 5 must connect owned-document selection
and form preparation to these records without weakening submission permission.
This interim phase does not establish that every collected employer form can proceed
to submission. Real ATS and model-backed acceptance are unrun.

No baseline or phase commit was made, and the original checkout is preserved. Phase 4
can now add confirmed answer reuse with code-only checks. Provider execution and the
continuation automation remain disabled pending the user's explicit approval.
