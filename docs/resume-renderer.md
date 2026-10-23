# Canonical resume rendering

New generated resumes use `openapply-canonical` version 1, derived from the supplied MIT-licensed
LaTeX resume (based on sb2nov/resume). The layout fixes US Letter, Computer Modern fonts and
the supplied font sizes, margins and macros. Education details and bullets render as bullets;
degree text retains any source honors inline. Empty sections disappear. All structured
content is escaped, including backslashes and braces; agents cannot supply LaTeX commands.

The API needs an **existing Tectonic executable**. Set `OPENAPPLY_TECTONIC_PATH` to an absolute
path, or expose `tectonic` on PATH. The
renderer never installs a compiler and never searches versioned Codex installation directories.
This is an API-host dependency: a compiler available only on the applicant's computer does not
make a remote API capable of rendering.

Optional configuration:

- `TECTONIC_CACHE_DIR`: writable cache directory, shared between runs.
- `OPENAPPLY_TECTONIC_BUNDLE`: deployed local bundle or approved bundle URL. Pin this and the
  compiler version in production for reproducible font/package inputs.
- `OPENAPPLY_TECTONIC_ONLY_CACHED=true`: refuse network resource fetches. Default false permits
  Tectonic's normal first-use support-file downloads. Warm the cache before enabling offline mode.
- `OPENAPPLY_TECTONIC_TIMEOUT_MS`: 1,000–90,000 ms, default 90,000. Two compiles may run at once;
  excess requests return an explicit retryable compiler-busy error.

The compiler receives an isolated temporary working directory, an argument array (no shell),
`--untrusted`, and `TECTONIC_UNTRUSTED_MODE=1`. Shell escape is not enabled. Temporary source,
logs and PDFs are cleaned after the result is read. Cover letters retain their existing renderer.

Compilation alone is insufficient. Validation checks exactly one page, Letter dimensions,
embedded Computer Modern fonts, unchanged approved sizes, expected extracted text, text bounds,
overlapping text runs, and compiler overflow/missing-glyph warnings. A failure returns an error;
it does not shrink, truncate, swap templates, or accept a second page. Automated bounds checks
do not replace visual review before submission.

`renderResumeArtifact` returns PDF bytes, generated source, template identity/hash, compiler
version and validation. Its template hash covers the preamble, escaping and mapping implementation;
the version must also change for an intentionally revised canonical design. Stored artifact
revisions, not ad hoc re-rendering, must back previews and application history. Original uploads
remain independent source files.

## Evidence and the saved artifact

The renderer receives structured content after tailoring validation; it does not gather evidence,
infer experience or validate the truth of prose. Tailoring resolves supported records from the owned
`ResumeEvidence` ledger and saves their exact snapshots under `audit.additionalEvidence`, alongside
source/JD snapshots, wording changes, targets and factual-review rationales. Ledger references carry
an evidence ID and revision and must quote the complete saved statement. They are bound to the base
version and, for an experience/project, its scope and entry hash. Stale, corrected, retracted or
unverified references cannot be reused. The ledger's latest state can change; historical artifact
snapshots, PDF bytes and TeX bytes remain unchanged.

Source checks distinguish exact resume/profile values and applicant-linked GitHub commit additions.
Anything else stays unverified. Profile-edit provenance has an explicit limitation; an
authenticated user-session origin does not prove factual truth. GitHub evidence cannot move into
an employer/project entry without the stored repository association, and does not establish sole
authorship, production use or outcomes. These source/scope checks supplement the agent's semantic
review; they do not replace it. See `resume-rewrite-v2-proposal.md` for the ledger API and controls.

Supported interpretations may clarify capabilities, decisions, contribution, scope and outcomes.
Original bullet numbers and named tools must survive. A new measurement requires its complete cited
outcome statement in the final prose, retaining the measurement's context. Unsupported details stay
outside the document as optional questions; missing optional answers do not block rendering a fully
supported draft. Rendering still rejects overflow rather than shrinking fonts or dropping facts.

For evidence-backed variants, compilation finishes before publication. The service then re-resolves
the evidence and verifies base/evidence revisions under row locks while creating the variant.
Correction or retraction during generation rejects publication and removes unpublished files.
Evidence correction after publication affects future use and never mutates a saved artifact.

Changed prose also carries `audit.workflowReview`: a JD evidence plan, reviewer findings/resolutions,
humanizer status/factual-drift check and optional questions. This is an agent report. Even a
`completed` status and named reviewer or skill do not establish that a tool ran or that the content
is semantically correct; verify actual agent/tool traces during a live trial. Unavailable stages are
reported as incomplete. Do not retrofit completion claims onto earlier artifacts.

The wording review UI associates text and evidence with the displayed PDF only when its entire
draft audit matches the immutable artifact audit, ignoring object-key order. On mismatch it shows a
warning and the revision-metadata path instead of presenting current draft wording as saved PDF
evidence. Drafts with no artifact are labeled accordingly. Download and preview continue to use the
pinned revision URLs and registered hashes.

Original-source fit remains a separate assessment of the uploaded original. An enriched document's
alignment review and the renderer's file-quality checks cannot raise that historical score or
establish an employer ATS acceptance probability. A blank native embedded PDF viewer is likewise
separate from PDF validity: check the downloaded revision's bytes, hash and rendering, and record
browser-preview compatibility independently.

## Renderer regression checks and limits

Run API renderer unit tests normally. Integration tests also run when an existing compiler is
available via `OPENAPPLY_TEST_TECTONIC_PATH` or PATH; they use synthetic
content and `--only-cached`. They skip on hosts without a compiler. `fixtures/canonical.pdf` is a
synthetic document compiled from `syntheticResume()` for environment-independent PDF validation.

Literal underscore, backslash, tilde and caret use the symbol encoding of Computer Modern
(`SFRM1000`) because the legacy OT1 underscore draws a line without extractable text. This font
is accepted only for those symbols; ordinary prose must retain the original font families.

Known limit: the supplied OT1 fonts do not cover all Unicode names or languages. For example,
`Zoë García` currently returns missing-glyph diagnostics instead of a PDF. Do not strip accents,
replace the applicant's name, or switch font families automatically. The one-page template can
also reject dense academic histories; content selection must be reviewed explicitly.
