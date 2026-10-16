# Resume rewrite design and implementation

Status: canonical rendering, immutable artifacts, the reusable evidence ledger and review audit are
implemented. Implementation and local checks do not establish successful live agent execution or
rewrite quality; see `rewrite-v2-validation-2026-10-07.md` for activation and observed trial results.
This document records the user's 2026-10-07 decision that **every newly processed resume uses the
supplied LaTeX format**, even when the input has a different structure. This supersedes the earlier
per-source visual-layout preservation proposal for generated outputs.

## Required output

Use a single versioned template derived from the user's supplied LaTeX (preserved in
`.temp/nava-latex/original.tex`) and the tested Computer Modern compiler settings. The template
owns US Letter size, fonts and font sizes, margins, section rules, spacing, bullets and header
alignment. The agent supplies structured content, not arbitrary layout code. Keep the template's
license attribution; replace all candidate-specific example data with fields.

New uploads, base previews, general rewrites and per-job variants all use this renderer. Preserve
uploaded originals separately for extraction, provenance and original-resume scoring. An Original
download remains the original file; the application-ready generated document uses the canonical
template. Existing submitted PDFs and their hashes are immutable. Regenerate older drafts only
through a deliberate conversion action, never by silently changing historical artifact bytes.

## Content pipeline

1. Extract facts from the selected source into a complete candidate record. Retain education
   locations, date annotations, projects, certificates and other source details even if they are
   not selected for a particular one-page document. Link facts to source text or confirmed answers.
2. Parse the full JD into individual requirements and responsibilities, preserving alternatives
   and distinguishing preferences from essentials. A stack list is not automatically a list of
   compulsory qualifications. Use job relevance to choose evidence and emphasis.
3. Gather relevant original-resume facts, saved profile facts, confirmed conversation statements and
   attributable GitHub contributions. Reuse current supported evidence records, then plan edits:
   source evidence, target criterion, proposed emphasis, content to retain and approximate space
   available. The strongest supported evidence gets the limited page space; irrelevant text does
   not become a fabricated qualification.
4. Rewrite selected experience/project bullets and the summary when useful. Use Google-style XYZ:
   achievement, real measurement, and method. When no measurement exists, use a specific action and
   supported outcome/scope; do not manufacture a percentage to complete the formula. Vary sentence
   structure naturally. Preserve scope and ownership when changing vocabulary.
5. Review the draft independently against the sources and JD, then invoke the humanizer skill and
   check its changes for factual drift. Identify unsupported claims, omitted important facts,
   awkward wording and weak use of existing evidence. Allow one bounded editorial revision, then
   produce the artifact or report the concrete remaining issue. Retain optional missing details as
   questions for later; omit unsupported claims and finish the supported document without waiting
   for an answer to every possible improvement.

Internally distinguish explicit source facts, supported interpretations and unverified suggestions.
Supported interpretations may be used automatically when the underlying facts entail the wording.
Unverified new technologies, metrics, employment, credentials, adoption or ownership stay outside
application-ready content until confirmed from actual experience. Do not attribute an outcome from
one employer/project to another. Capabilities, technical decisions, contribution, scope and outcomes
may be explained through supported interpretations; a likely or plausible claim is insufficient.

## Reusable evidence and correction controls

`ResumeEvidence` belongs to an owned base resume. It stores a statement, source, review rationale,
scope, verification metadata, revision and status (`supported`, `unverified` or `retracted`). The
API exposes paginated `GET` and `POST /api/resumes/:id/evidence`, full corrections through
`PATCH /api/resumes/:id/evidence/:evidenceId` with `expectedRevision`, and soft retraction through
`DELETE` on that path with `?revision=N`. Correction or retraction increments the revision;
restoration requires a new validated correction. These actions do not alter the base, original
upload, primary resume, historical scores or existing PDFs. Optional questions are candidate data,
not a waiting-state or confirmation requirement.

Sources use existing records and infrastructure:

- **Resume:** an exact quotation at a JSON pointer and current base version. Scoped evidence must
  belong to that same experience or project.
- **Profile:** the complete current value of an allowlisted identity/location/link field. These
  fields can support general evidence; a profile identity field cannot establish a contribution
  under a particular employer or project. Existing profile edits have no human-authorship audit.
- **Conversation:** an exact quotation from an owned `user`/`text` message. A scoped quotation must
  name the target employer or project. New chat messages and question answers receive server-derived
  `metadata.authorship`: authenticated user sessions are `session_user`, agent/PAT calls are `agent`.
  Known agent-authored messages cannot confirm personal facts or GitHub identity. Legacy messages
  without that provenance retain an explicit limitation: the speaker role is stored, but human
  authorship was not attested. Session origin does not prove the truth of a personal claim.
- **GitHub:** the API reads a public commit identified by its full SHA, checks the applicant-linked
  author login, and requires the exact quoted added lines from a changed file. Identity comes from
  the saved GitHub profile or an exact personal account statement in an owned eligible user message.
  Repository ownership, a matching substring in a username, another author's commit, and file
  context/removed lines are insufficient. A scoped entry must already link that exact repository;
  otherwise evidence stays general. Missing, private, oversized or truncated contribution evidence
  is not silently promoted. Commit association does not prove sole authorship, employment,
  production deployment, adoption or business outcomes.

The service rejects obvious negation, hypothetical examples, assistant-attributed suggestions and
document instructions when promoted to supported personal claims. It also checks new measurements,
recognizable tools/identities and selected scope/ownership claim families against the source. These
are conservative checks, not a complete semantic entailment engine; the review rationale remains a
fallible agent judgment. Agents must never create their own user-role message or alter a profile to
manufacture a confirmation.

Verification binds every evidence record to the selected base version and hashes a scoped entry.
Reuse rejects a changed base, shifted entry, stale revision, retraction or unverified status, and
rechecks mutable profile/chat sources. A source correction therefore cannot silently move a fact to
another employer. Tailoring cites `{evidenceId, revision, quote}` in `grounding.externalEvidence`;
the quotation must be the complete saved statement. The server resolves these references and copies
the exact records into `rewrites.additionalEvidence`, which becomes part of the immutable artifact
audit. Reusable ledger records retain their latest state; complete historical ledger revisions are
not a separate history store. Already saved artifacts retain the evidence snapshots they used.

Each edited bullet must still cite its complete original bullet and retain its original numbers and
named tools. Additional evidence must match that entry's scope. Summary/headline changes can use
general evidence with explicit grounding. A newly introduced measurement must retain the complete
cited outcome statement verbatim in the resulting prose, preserving the unit and measured outcome;
merely finding the same number elsewhere is insufficient. This conservative rule can reject useful
paraphrases. It never authorizes invented metrics, changes to dates/employers, or moving one result
onto another contribution. The canonical renderer, not a proportional text-growth allowance,
determines one-page fit.

## Review execution and its audit

Changed prose requires `workflowReview`: a per-JD evidence plan, independent-review status and
findings/resolutions, humanizer status and factual-drift check, and optional questions. A completed
review names its agent; a completed humanizer record names the `humanizer` skill. Optional run/tool
references can identify execution evidence. An unavailable stage includes a reason and is surfaced
as incomplete; older audits without these fields are not retrospectively labeled reviewed.

These fields are **agent-reported workflow**, not execution receipts. A valid saved
`workflowReview.reviewer.status: "completed"` or humanizer status does not prove a subagent or skill
actually ran. Live validation must inspect the actual agent/tool trace and the saved artifact,
separately evaluating semantic support and whether the rewrite clarifies JD-relevant evidence beyond
reordering clauses. A self-review or an outer assistant's audit cannot substitute for the product
agent's required independent reviewer and humanizer execution.

## Mapping different input structures

Standard order: Header, Summary when useful, Education, Experience, Projects when present, Skills.
Use the supplied template's visual styles for every section. Map additional factual sections such
as Certifications or Publications into the same heading and entry macros; retain their identity.
Omit empty sections. Do not manufacture projects, technical skills or employment to populate a layout.
The content can vary by applicant; fonts and formatting rules cannot.

Target exactly one page. Tighten repetition and phrasing, rank bullets/projects by job relevance,
and retain the full source record outside the selected document. Show meaningful exclusions in the
audit. Never invent continuity by hiding an employment entry or merging unrelated roles. If the
document cannot fit while retaining essential history and required content, report the conflict
instead of shrinking typography, clipping text or returning an unlabelled second page.

## Rendering and artifact storage

The canonical LaTeX renderer replaces the default JakeTemplate path for new generated artifacts.
Escape structured values into template fields, compile with a configured, versioned engine and font
bundle, and validate the actual result. The existing one-off Codex compiler path is not a production
dependency or deployable application integration.

Store a real artifact revision with base/source references, JD snapshot/hash, structured content,
template/compiler version, wording diff and evidence references, generated `.tex`, PDF bytes/hash,
page count and validation results. Preview, download, staging and application history must resolve
the same artifact revision. Do not regenerate different bytes at upload time or use cache replacement
to imitate a registered variant.

When a draft uses ledger evidence, publication re-resolves sources after compilation and checks the
base version and evidence revisions/status under database row locks before saving the variant.
Correction/retraction during generation rejects publication and removes the unpublished artifact
files. Later corrections do not rewrite an already registered artifact's evidence or bytes.

The resume detail UI shows reusable evidence and retraction controls. Its correction action opens a
user chat with the owner's correction so the agent can validate its source and save a new revision.
The wording review shows the saved PDF revision, before/after text, grounding, workflow reports and
optional gaps. It displays a draft audit as saved-PDF evidence only when the complete audit matches
the artifact audit (object-key order is ignored). A mismatch shows a warning and directs the user to
the immutable revision metadata. Without an artifact, wording is labeled as a draft.

## Evaluation and acceptance

Keep three separate outputs:

- Original-source fit: assesses the original evidence and preferences, independent of the rewrite.
- Document alignment: explains which supported JD concepts are now clearer and which remain absent,
  identifying any additional evidence used. It does not overwrite the original-source score.
- File quality: page count, fonts, readability, links, clipping and extraction checks on the PDF.

Do not represent any of these as a measured employer ATS pass probability. Do not run repeated
rewrites until the writer's own score increases. Compare original and revised prose using the same
criteria and a separate review pass, checking that improvements are supported by the source.

Acceptance requires:

- One page using the approved template's fonts, sizes and layout constants.
- Machine-readable text with intended sections, names, dates, technologies and measurements retained.
- No clipped or overlapping content; inspect the rendered page, not only extracted text.
- Every factual change supported; meaningful exclusions disclosed.
- Exact artifact hash survives preview, staging and submission-history storage.
- No generic-template fallback when compilation or validation fails.

Evaluate mixed inputs: the current Nava resume, an input with a different section order, a dense
multi-page input, a project-heavy graduate resume and a resume with few or no numeric outcomes.
Include content with LaTeX-special characters and absent optional sections. These cases should expose
formatting, extraction and factual-integrity failures before any real employer submission.

## Implementation boundaries

1. Canonical template and renderer: approve a baseline render; verify fonts, dimensions and extraction.
2. Artifact registration: store immutable generated files and connect preview/download/staging/history.
3. Stronger tailoring: support project bullets, XYZ where evidenced, and source-linked factual review
   in place of rigid content-word preservation. Keep stable factual checks for names/dates/metrics.
4. User-facing comparison: show PDF, edits, evidence, omissions, document relevance and remaining gaps.
5. Evidence enrichment: reuse the owned ledger, confirmed conversation/profile sources and bounded
   public GitHub commit evidence. Preserve optional questions and correction controls.

Original-source fit continues to read the uploaded source bytes, with its own source/JD/preferences
basis and cached assessment. Enrichment, wording changes and evidence corrections do not silently
rescore historical jobs or alter application thresholds. Broader GitHub ingestion, proof of personal
authorship for legacy/profile data, exhaustive semantic validation and complete ledger revision
history remain outside the implemented guarantees. Source patches, service activation, successful
agent execution and substantive rewrite quality must each be verified separately in the validation
report. No local check by itself establishes a successful live preview or employer ATS acceptance.

Reference: [Google resume-writing guidance](https://services.google.com/fh/files/misc/resume-writing-tips-for-veterans-2021.pdf).
