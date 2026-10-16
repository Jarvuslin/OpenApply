# Resume rewrite v2 implementation and validation

The accepted design is implemented in source. This report separates code/renderer checks from live
OpenApply agent trials. No employer application, submission, account or mailbox action is part of
this test.

## Implemented

- Canonical LaTeX generation from structured content, using the supplied layout and Computer Modern.
  Original uploads remain separate. Additional source sections use the same heading/entry styles.
- Grounded experience and project rewriting, including Google XYZ where the source supplies a real
  measurement. Each change cites source paths/quotes, a JD target and an explicit factual review.
  Source indexes refer to the unchanged base. Numeric/tool/scope guards remain; no default trimming.
- Independent review guidance, one bounded editorial correction, exact wording comparisons and
  separate original-source fit, document alignment and PDF quality reports. No ATS pass probability.
- Immutable artifact bundles: PDF, TeX, content, source/JD snapshots, audit, template/compiler details,
  validation and hashes. Preview/download use pinned revision URLs. Failed generation creates no
  successful-looking variant. Extraction saves independently of one-page fit.
- Submission checkpoints can retain the artifact revision and verify its PDF hash against the
  actual archived/uploaded file. Application recording carries that evidence forward. Original-PDF
  mode remains supported and does not claim a generated artifact.
- Education location/coursework and employment date annotations survive extraction/rendering and are
  editable. Existing incomplete extraction needs source-verified correction by OpenApply's agent.

## Checks completed

| Check | Result |
| --- | --- |
| Full API suite | 743 passed, 0 failed |
| Shared contracts | 42 passed, 0 failed |
| Companion regression suite | 311 passed, 0 failed, 0 skipped (separate build output; service kept running) |
| Final renderer/environment regression | 20 passed, including real Tectonic compilation |
| API and web typechecks | Passed |
| Resume/variant/application controller construction | Passed without starting a server |
| Scoped formatting and diff checks | Passed |
| Immutable storage and integration tests | Ownership, missing/corrupt bytes, atomic creation, provenance preservation, compile failure, cleanup covered |
| Submission evidence tests | Hash/ID mismatch rejection and history preservation covered |

Renderer regressions include differently structured sections, missing optional sections, extractable
symbols, missing compiler, long headings and multi-page content. Long/invalid output is rejected;
the template is never shrunk and facts are not silently discarded.

## Actual original-content baseline

Files under `.temp/nava-latex/`:

- `renderer-baseline.pdf` and `.tex`: actual output of the new renderer.
- `renderer-baseline-validation.json`: actual compiler/font/page/text checks.
- `renderer-baseline.json`: local fixture transcribed from the supplied original TeX; no tailoring.
- `renderer-baseline.png`: visual comparison image.

Result: one US Letter page (612 × 792 points); CMBX10, CMCSC10, CMR10, CMSY10, CMSY6 and CMTI10,
matching the original's six embedded fonts. All 14 source bullets retained. Education location and
the Oppfy date annotation are present. Actual PDF text/bounds checks passed, and the rendered page
was compared visually with the original. There is no clipping; normal engine line reflow remains.
The original template's harmless `fancyhdr` footskip warning is disclosed.

Baseline PDF SHA-256: `75de8da2eca50466559a3ed189041e7c5d8c11e26d09f5b321c52b5881c4a851`.
Template SHA-256: `f28bc18baab01815d8bda862355f7969e575a1e86f8d04498b281622755ad021`.
Compiler: Tectonic 0.17.0+20260731, existing installation, untrusted mode.

This baseline is a local renderer check, **not a new JD rewrite or saved OpenApply variant**.
The original `.tex` hash remains `01316fedc7b7071e8a8a61dc159ceb8f3c0eeef18bfaa4458f20d2c1ddc87270`;
the original PDF hash remains `24409d82222865e760a51f946da935d4a56c34bab870756260dea2b81a436abf`.

Current limitation: some accented names are unsupported by the fixed OT1 small-cap font setup and
fail with glyph diagnostics. The renderer never strips accents or silently changes fonts. Selected
code symbols use a constrained additional Computer Modern symbol font when needed; the baseline
does not need it.

## Live trial

OpenApply's Claude agent read two additional live postings through its own browser. It did not
score, save campaign jobs, rewrite, fill forms or apply during discovery:

1. Nava Benefits — AI Engineer (the existing requested stretch-role test):
   https://jobs.ashbyhq.com/nava-benefits/d1ef174d-42dd-4910-9b46-05cdee223db0
2. Superhuman — Software Engineer, Full-Stack – GPTZero, Early Career, Toronto hybrid:
   https://jobs.ashbyhq.com/superhuman%20platform%20inc/134c282c-2837-44a8-9f7c-74ca39486490
3. Zip — Software Engineer, New Grad (2027 Start), Toronto hybrid:
   https://jobs.ashbyhq.com/zip/b5242472-5679-4084-af77-238b6335b792

Zip's stated graduation window (December 2026–June 2027) conflicts with the original May 2026 date.
That makes it a useful negative eligibility test; a stronger rewrite must not invent a qualifying
date. The full postings must be read again for the saved assessments, not reconstructed from chat
summaries. The earlier Nava score remains an original-source assessment, not an updated-document
ATS result.

The user completed the documented activation on October 7 at about 14:25 Toronto time. API and
companion health were verified, and the existing chat reconnected successfully. An initial companion
connection refusal was a startup race; no further process actions were needed. Automatic approval
review had previously rejected assistant restart with reason "blocked by policy"; no alternative
runtime workaround was used. See `local-restart-after-audit.md`.

At 14:31 the outer assistant sent one ordinary preview request in the existing OpenApply chat for
the three selected jobs, and used the visible Connect this computer control. OpenApply's Claude
agent began working at 14:32. The headed VM viewer is open. No tailored prose or live application
record was supplied by the outer assistant.

### Observed results (14:32–14:38 Toronto)

OpenApply's Claude agent completed all three previews. It repaired the missing education location
and Oppfy date note from the original, regenerated the variants from source version 3, and retained
the original PDF bytes. It downloaded the registered PDF/TeX, rendered pages and reported checking
them. The outer assistant did not author or upload any rewrite. No applications were submitted.

| Job | Saved original-source score | Final variant | PDF / source integrity | Rewrite quality |
| --- | --- | --- | --- | --- |
| Nava | 35/100 (existing assessment) | `02368135-7249-445a-91cf-e9b9a17f7a0a` | Pass | Two supported result-first edits; moderate improvement |
| Superhuman | 66/100 | `92f9c206-28cb-405a-a456-cc06876b3416` | Pass | Three supported edits; limited differentiation |
| Zip | 54/100 | `7756fdf9-a54b-4bdc-b273-a210905501b0` | Pass | Same three edited sentences as Superhuman; graduation mismatch retained and reported |

Registered revision hashes:

- Nava: `203def54805edfa6ef589631a9315cf4feb6ff26fab0db53b299328633454467`
- Superhuman: `7b44b44cb58261e91685034f488c3d4d46677a6cc7f4d854fefce5afe6c39854`
- Zip: `f3df2e4b54ad7faa9b7d121682258e9b2fb302cabb9f75269791b9476cf61408`

Independent verification read the actual durable artifacts without modifying app state. All three
are one Letter page with the same six embedded Computer Modern fonts as the original. All 58
expected text fragments, 14 bullets, employers, titles, locations and dates were recovered. PDF,
TeX, source, content, JD and revision integrity checks passed. Rendered pages show no clipping or
overlap. Exact audits resolve against their saved source/JD snapshots; no invented numbers, tools,
employers or ownership claims were found. Evidence: `.temp/rewrite-v2-audit/independent-pdf-audit.md`.
Agent downloads and images are in `.temp/t7d0c-v2/`; durable originals are in API storage.

### Failures and limits observed

- Scoring confuses future work on employer-specific products with required prior experience.
  Superhuman's product names, future 40-million-user scale, learning and mentorship opportunities
  lower its score. The saved arithmetic is consistent; the agent's classification is flawed.
- The final reply incorrectly calls 65 the user's minimum. The current `/api/users/me` snapshot
  has `autoApply.minMatchScore: 20`. No threshold change was made in this trial.
- The lexical guard rejected the ordinary result verb “Reached” as an unsupported technology.
  The agent retained the original bullet instead of bypassing validation.
- The agent skipped the required independent reviewer and humanizer pass, and disclosed this.
  The outer audit is useful evidence but does not make the app workflow itself fully pass.
- Superhuman/Zip saved snapshots include the role's requirements and responsibilities but omit
  company/benefits boilerplate; they are not complete page snapshots.
- A runtime permission denial during nonessential scratch cleanup left the chat in “Waiting for
  your reply” after completed output. Downloads succeeded. No denied deletion was retried by the
  outer assistant. The current chat also renders Markdown tables as literal pipe-separated text.
- The saved-PDF modal in Codex's in-app browser shows a blank native PDF frame. Direct downloads
  from all three visible PDF links succeed and match the registered hashes. No console error or
  local CSP/frame restriction was found. Native embedded-viewer compatibility is the likely cause,
  not invalid PDF bytes; this remains an open UI issue. Screenshot:
  `.temp/rewrite-v2-saved-nava-preview.jpg`.

Overall: **PDF format and factual preservation passed; stronger job-specific rewriting and complete
review workflow only partially passed.** The internal scores are not employer ATS decisions or
probabilities. No employer ATS acceptance was measured, and Zip's eligibility issue remains.

### Corrections after observation

The observed “Reached” guard false positive is fixed in source, with a regression that still rejects
invented technology and inflated quantities. The targeted factual/grounding tests pass (28/28).
This post-trial patch has not changed any of the saved trial PDFs or scores.

Scoring guidance now separates transferable capability from employer product names, future audience
size, offered learning and mentorship, preserves contribution scope and alternatives, and explains
consistent duplicate handling. New or genuinely changed-input evaluations use rubric version 2.
Unchanged historical version-1 assessments remain readable and valid for queue decisions; no bulk
rescore or silent score invalidation was introduced. Ninety-one scoring/fit/promotion checks passed.

Rewrite guidance now explicitly requires a per-JD evidence plan, full saved JD, independent reviewer
when available, and actual humanizer invocation. Stronger semantic results need another agent trial;
the observed saved PDFs were not retrospectively changed or claimed to satisfy these missing steps.

Companion Claude/Codex permission denials now remain visible without inventing an unanswered user
question. Actual user-input requests still wait, failed turns still fail, and denials remain enforced.
Duplicate Claude denial messages are suppressed. All 320 companion tests passed in isolated output.
Chat guidance requires refreshed current settings and distinguishes historical skip reasons; the
user's saved minimum is 20, while Nava's historical skip reason contains 65. No settings were changed.

API and web typechecks and scoped formatting checks passed. At the end of that trial these patches
were source-only. The follow-up below records their later verified activation; the earlier artifacts
were not changed retrospectively. The old one-time activation helper is tied to pre-restart process
identities and must not be reused unchanged.

## Evidence-aware follow-up (October 7, from 15:30 Toronto)

The follow-up adds reusable owned evidence to the existing extraction/tailoring/artifact pipeline,
without a second resume store or a new scoring path. See `resume-rewrite-v2-proposal.md` and
`resume-renderer.md` for the implemented API and trust boundaries.

- Evidence records distinguish explicit assertions, supported interpretations and unverified
  details. Sources carry exact resume/profile/chat references or individually attributable GitHub
  commit/file lines. Records bind to the resume version and entry scope, and are revalidated before
  artifact publication. Corrections and retractions advance revisions; immutable artifacts retain
  the evidence snapshot actually used.
- Authenticated agent-token messages cannot manufacture user confirmation, including by answering
  a question. Session-origin messages are labelled, while legacy messages disclose missing author
  attestation. These labels establish origin, not the truth of an assertion. Semantic interpretation
  still requires fallible model review.
- Variants resolve current evidence revisions, preserve original bullet anchors, reject cross-entry
  attribution and unsupported numbers/tools, and record per-JD plans, review findings and optional
  questions. New measured outcomes require their full cited statement, not a borrowed number.
- The resume UI exposes provenance, correction/retraction controls, before/after wording and the
  workflow report associated with the exact PDF revision. Complete audit equality is checked before
  displaying a current variant's typed review beside an immutable artifact.
- The companion records safe invocation IDs, reviewer/skill names and started/completed/failed
  events. Claude content blocks share message IDs; a discovered deduplication bug was fixed to use
  envelope UUID/tool invocation IDs. Reports alone do not prove execution, and a Skill loading
  acknowledgement alone does not prove that its editing procedure was followed.

### Activation and checks

`scripts/activate-resume-evidence.ps1` checked the actual listener process IDs, exact UTC starts,
executable identities, idle chat/Pilot/session state and the existing Tectonic compiler before
restarting the API and companion. The web server, VM and database stayed running. The additive
evidence-table migration applied successfully. The trace deduplication fix then received a second
verified activation before any new rewrite started. The obsolete helper was not reused.

| Check | Result |
| --- | --- |
| Full API suite after evidence/authorship integration | 790 passed, 0 failed |
| Web suite | 151 passed, 0 failed |
| Companion suite after trace fix | 328 passed, 0 failed, 0 skipped |
| Shared contracts and targeted provenance checks | Passed |
| API/web typechecks, knip and scoped formatting | Passed |
| Actual Tectonic integration tests | Passed; no renderer/template changes |
| Repository-wide `bun run ci` | Blocked by three pre-existing errors in `t7d0c-gen.js`; left intact |

Logs are under `.temp/evidence-*-final.log`, `.temp/evidence-web-tests.log` and the isolated
`.temp/runtime-trace-block-tests` output. Existing uncommitted work was preserved. A duplicate React
key warning found in the live artifact modal was fixed with distinct preview/wording key prefixes;
web typecheck and the scoped format check passed afterward.

### First follow-up preview run (15:36–15:40)

OpenApply's own Claude agent performed run `b52d047d-57fe-4837-bf68-7a788c162520` in the existing
chat. The outer assistant supplied task constraints and diagnostics, not applicant resume prose.
The headed VM viewer and agent progress remained available. No optional question blocked the run.

| Job | Variant | Revision | Changed bullets |
| --- | --- | --- | --- |
| Nava | `94149131-5fd9-4b39-8460-451a286c41a2` | `1f9ff3899d61122d51828b72c85caab648cc5570b4884b2c0db635cbd974a3bf` | 1 |
| Superhuman | `222d4806-7f90-432b-82b9-873fd5382e2a` | `fbee3d6be8123364e8ac63cd7aff6cba4f8fe94be3e6b056feafad136d2a1e3e` | 4 |
| Zip | `69341db1-4026-4f96-8f07-7fa0ab6bcfee` | `00debc970d8c63e44279c7230a2ef3ea73d52aac591bb94eefd5d214b3fcc970` | 4 |

All three durable PDF/TeX bundles passed hash, original-source, content and JD snapshot checks.
Independent PDF inspection found one Letter page, the same six embedded fonts and font sizes,
14 rendered bullets, all employer/title/date/location fields and no out-of-page text. All three
rendered pages were inspected visually; no clipping or overlap was found. The canonical template
hash remains `f28bc18baab01815d8bda862355f7969e575a1e86f8d04498b281622755ad021`.

The agent invoked the independent `openapply:resume-reviewer` and `openapply:humanizer`. The
reviewer read the exact source and all three JD/draft packs, flagged weak clause rotations and
causal overreach, and returned actual findings. Workflow metadata lacks invocation/run references;
provider logs and safe chat events provide separate execution evidence. Optional questions were
retained in the audits rather than asked as prerequisites.

**Substantive tailoring did not fully pass.** Nava's sole changed sentence exactly repeats the
earlier RAG result-first edit. Superhuman/Zip add useful but modest summary emphasis; most bullet
edits remain clause rotations, with three sentences shared between them. Their summaries refer to
supporting experience/project facts in rationale without citing those actual paths. The underlying
facts are present, but that evidence map is incomplete. No additional ledger evidence was used, so
this live run does not demonstrate reuse of new supplemental facts.

The generic workflow was then tightened: a reviewer finding of mostly clause rotation requires a
substantive bounded correction where existing evidence supports one, rather than merely dropping
edits or changing order. Already effective passages may remain with specific reasons; there is no
quota or license to invent distinctions. Summary/headline grounding must include all source paths
used for their claims. A further controlled agent pass tests those instructions.

Audit files: `.temp/rewrite-evidence-audit/trial-audit.json`, `pdf-inspection.jsonl`,
`state-preservation.json`, `independent-quality-review.md` and per-variant JSON/text/rendered pages.
The first follow-up's before/after database comparison confirms unchanged base version/content,
primary resume, all historical variants, entire saved job records (including scores 35/66/54),
minimum threshold 20 and application count 0. Both the original uploaded PDF hash and the unrelated
old `.temp/nava-latex/nava-ai-engineer.tex` hash remain unchanged.

### Controlled correction run (15:43–15:48)

OpenApply's Claude agent completed run `dfc762d2-5de3-4b3b-b1fa-fc3c0ce74707`, again without
outer-authored resume prose. It read the revised instructions, invoked a fresh independent reviewer
and the humanizer, applied a bounded correction, and saved three additional variants. All previous
variants remain. Both new chat runs ended `completed` with no error or outstanding user question.

| Job | Final variant | Final revision | Before → after and assessment |
| --- | --- | --- | --- |
| Nava | `a1bd932c-3511-4cff-a5ec-db88676d430e` | `a0bd0043d49838b918f70ce1bed4d6110209ac6f3a2eef0db29f470b551a29a7` | Generic LLM summary → measured evaluation, cited verdicts and guardrails; the AdReady bullet now links those guardrails to the evaluator agents. Useful supported synthesis, but longer wording and limited new explanation. |
| Superhuman | `9cd3872c-ac21-4d3e-86b6-2f0ed01919d1` | `ee95cabc53dcb78124a885f3b8fcfd040816bedc04084b505123160253c8a2e4` | LLM-only summary emphasis → also names supported full-stack TypeScript work. Original bullets retained; no broad bullet-rewriting improvement demonstrated. |
| Zip | `b7cddce1-2860-42a5-9293-bd24dd97eeaa` | `de60c157be6aa3e7acbdfeee0fa69a7384689787b484a7cb2d8a9c97027d2de3` | Summary adds supported web/API capability; Compugen's FastAPI interface becomes the bullet's subject. Modest clarification; GraphQL remains absent and the graduation mismatch remains visible. |

All summary additions now cite the exact underlying experience/project paths and full quotes.
The reviewer caught an unsupported implied connection between Kingston's scraper and review tool;
the writer removed it. Nava's first revised summary was rejected for introducing `100` without
retaining the complete measured outcome; the agent removed that summary number while the original
complete 100-query/86%/94% result remains in the employment bullet. No guard was weakened.

Final PDF/TeX verification passed independently:

- All three exact saved PDFs are one Letter page with 14 rendered bullets, unchanged canonical
  template hash, original font families/sizes and no clipping or text outside the page. The rendered
  final pages were inspected. All original employment, project, education, skill and quantitative
  facts were retained; the independent semantic audit found no invented personal facts.
- All three PDF and all three TeX links were downloaded from the visible OpenApply chat through
  the browser. Every downloaded file hash matches its immutable manifest. Evidence is in
  `.temp/rewrite-evidence-audit/browser-download-checks.json`.
- Source, content, JD snapshot and revision integrity passed. Final before/after database comparison
  again confirms unchanged base/primary/original, all historical jobs and scores, threshold 20,
  earlier variants and application count 0. The old standalone TeX was not used or overwritten.
- The final product modal shows the same revision for its PDF, TeX, source citations and before/after
  wording, including the new summary. Its duplicate-key warning no longer appears after reload.

Actual execution receipts (separate from artifact self-reports):

| Run | Independent reviewer invocation | Humanizer invocation |
| --- | --- | --- |
| First follow-up | `toolu_01LMJFLQN3zjnNP3pp79YdGr` | `toolu_01BfUjDDcmb4LQmsgjs4aowJ` |
| Controlled correction | `toolu_017KYqixujiAerRr8beaxwKo` | `toolu_017tXAaHjweUTdMgu2yUxRZH` |

The reviewer child logs confirm reads of the source and all three separate JD/draft packs plus
actual findings. Humanizer-attributed subsequent events and the before/after text demonstrate
application beyond loading the skill. Both reviewer verdicts preceded the writer's correction;
there was no final second reviewer approval. Full trace findings and their limits are in
`.temp/rewrite-evidence-audit/workflow-execution-audit.md`.

### Final outcome and remaining limitations

**Format, artifact identity, factual preservation and actual review/humanizer execution pass.
Deeper autonomous tailoring and supplemental-evidence uptake remain partial.** Final summaries
are more specific to each JD, with a supported Nava relationship and a modest Zip API clarification.
This is not a wholesale improvement in every bullet; additive summaries and Nava's first/second
wording remain less concise than desirable. No rewrite-derived score was created.

- The agent listed 25 public repositories but inspected metadata/README/latest commit lists for
  only two. It did not establish new contribution evidence from commit-added lines. Therefore the
  claim that no attributable GitHub work exists is broader than the search supports. Both live runs
  used zero supplemental ledger records; provenance, correction and retraction are covered by
  automated tests, not demonstrated here with new personal facts.
- The generic evidence workflow now requires JD-relevant repository selection, exact inspection
  coverage and unresolved-source reporting, and allows supported general-scope contributions
  without assigning them to an employer. That final guidance clarification has **not yet had a new
  live GitHub-evidence trial**. No eligibility or experience claim was manufactured to fill this gap.
- Saved workflow objects contain reviewer agent handles but omit run/invocation references. The
  receipts above and provider logs reconcile execution externally; metadata alone remains
  insufficient. Retained-passage reasons exist in draft packs, while final immutable notes list
  their paths without those full reasons. The final agent report overstates their persistence.
- The native PDF frame remains blank in Codex's in-app browser. This is still a separate preview
  compatibility defect: actual downloaded bytes, text, font/page checks and independent page renders
  are valid. It is not counted as a PDF-validity failure.
- Historical original-source scores remain Nava 35, Superhuman 66 and Zip 54. The saved minimum is
  20. Zip's May 2026 versus December 2026–June 2027 graduation conflict is unchanged. Internal
  document checks cannot establish an employer ATS acceptance probability.

No application, submission, account creation or email check was performed; Gmail OAuth remains on
hold. Existing work remains uncommitted and no unrelated cleanup was attempted.
