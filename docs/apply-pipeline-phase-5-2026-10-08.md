# Phase 5: scripted form preparation

Prepared October 8, 2026. Phase 4's deterministic gate and immutable snapshot
are complete. This phase continues in the attached worktree without providers,
normal database migrations or employer submissions.

## Plan

Use confirmed question answers and an explicitly selected, owned PDF to prepare
supported native ATS controls in code. Keep observation, factual confirmation,
document selection and final submission authority separate.

- [x] Add immutable, human-confirmed document selections for supported resume uploads.
- [x] Validate document ownership, exact revision/hash, current question and source evidence.
- [x] Expose a bounded preparation manifest and append-only observed readback results.
- [x] Fill native Greenhouse, Lever and Ashby controls with typed readback and bounded reinventory.
- [x] Return explicit fallback for custom, unfamiliar, conditional or multi-page ambiguity.
- [x] Add code-only companion preparation preview and a reusable plugin fill core.
- [ ] Connect the fill core to owned live workers in Phase 7.
- [x] Add explicit PDF selection and preparation feedback to the job question UI.
- [x] Verify disposable migrations, database invariants, fixture browser behavior and UI separately.

## Boundaries

A filename cannot answer a file question. Only exact owned canonical resume
artifacts with explicit selection consent can resolve supported resume upload
requirements. Unsupported document purposes remain blockers. Rendering a PDF
does not establish its factual accuracy; existing artifact, original-source,
checkpoint, archive and duplicate-submission checks remain necessary.

Standalone preparation runs in a fresh isolated browser context and closes it.
It provides verified readback evidence, not a retained application ready to submit.
The UI must state that distinction. A worker integration must operate only within
its own valid queue lease and form context; preparation never calls a model,
clicks Submit/Next, or silently upgrades unknown coverage to complete.

Real provider final review/fallback and a full model-backed application campaign
remain unrun pending explicit approval. Prior application evidence is preserved.

The reusable fill core exists, but a live worker handoff is not yet implemented.
Attaching it to the current shared browser would risk touching an unowned page.
Phase 7 must supply and verify dedicated worker/browser ownership before enabling
this integration. A successful preview is not a real application-workflow pass.

Source changes now invalidate selected documents immediately under the same
account lock as the write. Base and variant edits, removal, source replacement
and applying a variant restore current file blockers and publish Queue/Needs-you
updates. Active leases and immutable submission evidence remain fenced. Retention
cleanup preserves variants with current selections. Exact supported labels include
the preserved fixtures' "Resume PDF"; purpose matching remains an allowlist.

Phase 7 also carries a code-only PDF integrity check before claiming expensive
work. Current preparation, download, checkpoint and submission guards validate
stored bytes, while the queue's current blocker test validates database metadata.
The later preclaim check must reject corrupt/missing bytes before model dispatch.

## Deterministic evidence

Migration `phase5-migration-20261008-a` passes six groups on newly created and
verified database `apply_e2e_f65c45e2b418`. It applies 63 baseline migrations and
`20261008230000_application_preparation`, SHA-256
`15f7d1d71f4f128b547dc6f65cb1e1d09c18729aa5237020ba56597bffde2b6d`.
All 57 existing tables remain byte-identical. Historical file names were not
promoted to consent, and an existing queue item, saved-answer revision and
ambiguous submission remained intact. Human-selection, file-size and unique
current-selection constraints passed; probes rolled back. Bridge 15434 is closed.

Database run `preparation-20261008-a` passes 12 groups on `apply_e2e_92c81fac2229`.
It uses a real locally compiled, structurally validated synthetic PDF, reused
across fixture artifacts. Selection, original-source identity, exact downloads,
artifact corruption, source deletion/replacement, stale manifests, grouped
questions, incomplete coverage, readback and submission/lease refusal pass.
It does not treat compilation as factual review or application acceptance.
Preserved database fingerprint:
`6d6d87d42e19d2108adc7560731f21ddc4b5a67ee583908f86aef12e42218eee`.
Preserved storage fingerprint (95 files):
`26411d0a909759eff447b8c3e2ea9910e6190cec6d5fed9c3357004928a2239d`.

The separate guest browser test covers all four preserved Phase 1 layouts.
Greenhouse, Lever and Ashby native values, independent authorization/sponsorship,
conditional details, prose and PDF bytes read back exactly. The unfamiliar form
does not advance beyond its first step. Dynamic/multi-page completeness remains
explicitly partial and the fixture recorded zero submission attempts.

Safe blank optional native controls now return `omitted`, with no factual value
or document hash. They render as "Left blank" and no longer force model fallback.
Unconfirmed defaults, required/conditional/hidden/custom/disabled controls, empty
choice catalogs and files remain blocked. The API verifies the permitted context;
native blankness remains an adapter observation, never a human-confirmed answer.

UI run `preparation-ui-20261008-a` preserved clone `apply_e2e_c333b720046c` after
an observer failed on two identically named Resume headings. No selection, token
or preparation request occurred. Source database/storage integrity passed and
owned processes stopped. The prompt locator and redundant heading semantics were
corrected for a separate clone-only retry. No database or application acceptance
was replayed. The runtime inventory now also hashes imported URL policy/runtime
helpers, closing a source-integrity gap found in independent review.

UI run `preparation-ui-20261008-b`, clone `apply_e2e_51786970c976`, passed the
four substantive document/preparation observations using the real companion and
exact PDF hash. It then failed the final console audit because the harness blocked
Chromium's built-in PDF-viewer resources. It made exactly one selection, terminal
token and preparation request, with no Chat navigation. Both database and storage
source fingerprints remained unchanged. This failure is preserved separately from
the successful preparation observation; the full UI gate is not relabeled passed.

The ordered code gate passes: Biome 1,320 files, knip (existing pg dependency
hints only), API/web typechecks, 1,252 API tests / 3,886 assertions, 50 contract
tests / 183 assertions, and 374 .NET Release tests. Additional web tests pass
230 / 588 assertions; fixture/harness tests pass 96 with two guest-only Windows
skips. Preparation harness guards pass six with one guest-only Windows skip;
the guest four-layout browser test passes separately. The filler/omission guest
suite passed ten, the real host-to-guest helper protocol passed one, and the final
empty-choice guard's focused guest suite passed four. Logs live under
`.temp/preparation-regression/`. A mistyped nonexistent `test:apply-harness`
command launched no tests; the actual `test:apply-e2e` fixture suite passed.

After the duplicate-heading correction, the focused rendered-card test passed
four assertions, web typecheck passed, Biome checked 1,321 files, and the expanded
preparation harness passed eight tests with its guest browser test skipped on
Windows. Earlier code checks remain valid for unchanged modules.

Final UI run `preparation-ui-20261008-c`, clone `apply_e2e_26573d66031a`, passes
all five observations. It verifies explicit PDF consent, exact immutable document
identity, safe queue release, real companion native readback and persistence after
refresh. Exactly one selection, token and preview request occurred, with no Chat
navigation. The guest form received one GET and no submission. The zero-budget
host remained disconnected from queue execution. Its binary and all executed
helper sources remained unchanged; original database, document storage and report
fingerprints passed. The owned processes stopped and bridge 15433 closed. The
normal companion on 4102 was untouched. Screenshots were inspected.

The harness now permits only 15 observed GET resources belonging to Chromium's
built-in PDF viewer; other internal pages, extensions, opaque origins and methods
remain blocked. A separate synthetic-PDF probe established this set without an
OpenApply service or model. The final harness passes 11 guards with one guest-only
Windows skip; final Biome checks 1,323 files and knip passes with the same existing
dependency hints. Expected logged-in transition/offline-companion diagnostics are
tracked explicitly; uncaught runtime errors are absent.

## Result and next gate

The independent Phase 5 implementation and deterministic gate are complete.
Provider requests, employer submissions and migrations on normal databases: zero.
No model-backed workflow or factual resume review is claimed. Native AOT publishing
still lacks the previously reported Visual Studio C++ linker; the managed Release
host was rebuilt and exercised by the isolated UI run.

Phase 7 must connect the reusable filler to dedicated owned worker contexts and
add preclaim on-disk artifact integrity checks. Final Sonnet review/fallback and
one-submit-only model-backed workflow acceptance remain unrun pending explicit
approval. These deferred gates remain visible in the main plan. Phase 6 may now
build and verify independent shadow-evaluation infrastructure without inference.
No staging, commit or push occurred; the user's baseline commit is still pending.
