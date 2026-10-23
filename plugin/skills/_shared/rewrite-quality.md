# Source-grounded resume rewriting

Use this review for both general improvements and JD-specific variants. Keep the original source
and the complete extracted candidate record unchanged. Every generated resume uses OpenApply's
versioned canonical LaTeX template, including inputs with a different visual structure. The template
owns fonts, sizes, margins, section rules and spacing; the agent supplies content.

## Plan and draft

Read `resume-evidence.md` first. Gather available relevant evidence without a confirmation interview.
The original resume remains the baseline; reusable evidence is additional context, never a silent
edit to the source or its fit score. Optional missing detail belongs in the audit and must not stop
completion. Finish with supported content and explicitly name the remaining gap.

1. Read the full saved JD, not a digest or keyword list. Retain that exact snapshot in the tailoring
   request so the registered artifact records the same source and target quotes. Split compound
   paragraphs into individual requirements and responsibilities for the edit plan. Preserve
   alternatives such as "Python or TypeScript" and separate essentials from preferences. Apply the
   capability/context distinctions in `original-fit.md`: future employer products and offered
   training are not qualifications to invent in the resume.
2. Map relevant source achievements and valid additional evidence to those criteria. Missing evidence
   is a gap, not permission to add a qualification. Do not claim GitHub knowledge unless actual
   repository evidence and the applicant's contribution were read and attributed. Record a separate
   evidence plan for each JD: capability, technical decision, contribution, scope or outcome that
   the reader should understand better. Do not equate more edited bullets with a better document.
3. Rewrite the experience and project bullets whose useful evidence is buried or unclear. Use
   achievement → real measurement → method (Google XYZ) when the source supports all three.
   Otherwise use a concrete action and supported outcome or scope. Never invent a measurement to
   complete the formula. Keep effective original wording; avoid repetitive sentence patterns.
   Moving an unchanged result to the beginning can help readability, but is not by itself substantial
   JD targeting. For each planned edit, identify the supported capability made clearer, the relevant
   criterion and the readability improvement. Clarify method, scope or outcome using the cited same-
   entry facts where useful; do not merely rotate clauses to produce a rewrite count.
   When those facts support a useful interpretation, draft it: explain the capability demonstrated,
   how the method relates to the work, a documented technical decision, the applicant's contribution,
   or the supported scope/outcome that the existing sentence leaves implicit. State in the plan what
   the reader can now understand and which exact facts entail it. Combine multiple pointers within
   the same experience or project when that relationship is supported. Do not reject a meaningful
   interpretation simply because its wording is absent from the original; do reject an inferred
   motive, architecture, requirement or outcome that the evidence does not establish. If no useful
   supported interpretation is available, retain the text and give a specific evidence-based reason.
4. Use the JD's vocabulary when it accurately describes the same work. Preserve individual
   contribution, dates, employer/project attribution, tools, scope and causality. Rephrasing a
   team achievement as sole ownership, an experiment as production adoption, or a prototype as a
   durable platform changes facts. Keep such unsupported suggestions out of generated content.
5. Keep every employment and education entry by default. Tighten redundant wording to fit one page;
   do not shrink fonts or edit layout. Any deliberate content exclusions must appear in the audit.
   A fit failure is a failed draft, not an excuse for a hidden second page or silent deletion.

Review the summary/headline and both experience and projects for the requested role, without forcing
an edit to every section. Retain already effective text and say why it fits. For multiple JDs, make
an independent evidence-to-role plan for each: shared wording is valid when the same achievement is
the best evidence, but changing target quotes alone does not establish improved alignment. Never
add arbitrary differences or unsupported claims just to make the outputs look distinct.

## Grounding each change

For tailored prose edits, attach `grounding` with exact source JSON pointers and quotes, a target,
and an explicit review. Pointers refer to the selected base content before restructuring. Use
`grounding.externalEvidence` for reusable ledger references as described in `resume-evidence.md`;
the API resolves their current owned revisions and snapshots them in the artifact audit.

```json
{
  "evidence": [{"path": "/experience/0/bullets/1", "quote": "<exact full original bullet>"}],
  "target": {
    "kind": "job_description",
    "quote": "<exact excerpt of the full jobDescription supplied in the request>",
    "reason": "<why this existing achievement is relevant>"
  },
  "review": {
    "verdict": "supported",
    "claimType": "explicit",
    "rationale": "<how the cited source supports the final wording and preserves scope>"
  }
}
```

Use `claimType: "supported_interpretation"` only when the cited facts entail the new wording;
"probably true" is insufficient. A bullet must cite its exact original full bullet. Additional
evidence must be scoped to the same experience or project, never another employer's achievement.
For a general review use `target.kind: "general_review"` and explain the wording improvement.
Ground summary and headline changes too. Unknown facts can become concise questions for the user,
but never include unanswered suggestions in the application-ready PDF.

For summary/headline wording, cite the actual exact pointers and quotations supporting every
capability, method, scope and outcome used. Include the experience/project evidence that the wording
draws on, even when an existing summary already gestures at the same topic. Citing only `/summary`
while the rationale refers to uncited experience or projects is incomplete grounding. A rationale
explains the relationship; it does not replace the underlying source citations.

## Independent review and bounded revision

After drafting, actually invoke the `resume-reviewer` agent (or a general-purpose independent agent
following its instructions) when subagents are available, even if the writer already checked its
own draft. The root agent owns this handoff: if a `job-worker` lacks delegation tools, return its
draft/evidence files to the root for review before saving. Give the reviewer the exact original
source/extraction, resolved additional evidence, full JD and proposed diff; request evidence/quality
findings only, with no browser, API writes or application actions. One reviewer invocation may
review multiple drafts if each source/JD/plan/diff is clearly separate. A writer's own
`review.verdict` does not replace this step. If delegation is unavailable,
perform a distinct review pass and disclose that independent review was unavailable; never claim
another reviewer inspected the document.

Check every new claim, number, unit, tool, ownership implication and causal statement. Numbers must
retain the same outcome and population, not merely survive somewhere in a sentence. Additional
same-employer evidence must actually support the relationship being stated. Check source omissions,
including education locations and employment date annotations, and whether the draft surfaces useful
evidence beyond rearranging clauses. Record reviewer findings and their resolution in
`diffNotes`; do not label model review as proof of truth.

Invoke the `humanizer` skill in embedded mode on changed prose, even after the writer's or reviewer's
own style check. Preserve the source/JD map and compare its output again for factual drift. Record
that the skill ran; do not describe a generic self-check as a humanizer invocation.

Use the provider's Skill invocation when available (Claude: the installed `openapply:humanizer`
skill). Reading its file is preparation, not execution. On providers without a Skill tool,
explicitly run its embedded procedure as a separate pass, retain the before/after output and report
the execution mechanism honestly. Never invent a tool receipt. Do not delegate the whole rewrite
and then omit review because the worker returned a finished-looking result.

New prose edits require `workflowReview` in the tailoring request:

```json
{
  "workflowReview": {
    "evidencePlan": [{"target": "<JD capability>", "sources": ["<base path or evidence id@revision>"], "change": "<what the supported edit makes clearer>"}],
    "reviewer": {"status": "completed", "agentId": "<actual reviewer handle or exposed name>", "findings": ["<finding>"], "resolutions": ["<correction or grounded reason to retain>"]},
    "humanizer": {"status": "completed", "skill": "humanizer", "factualDriftChecked": true},
    "optionalQuestions": ["<useful missing detail for later, if any>"]
  }
}
```

Include actual `runId` and `toolInvocationId` for completed review/Skill records when the runtime
exposes them; do not guess them. Metadata is an agent report, not proof of tool execution or factual
truth. Tool activity is audited separately. If a step truly cannot run, record
`{"status":"unavailable","reason":"<concrete limitation>"}` for that step. Finish a supported
preview with the resulting incomplete-review flag, never claim full workflow acceptance, and do
not block on optional questions. Historical artifacts without these records remain historical.

Allow one editorial correction after review. If the reviewer finds mostly clause rotations while
useful supported evidence remains buried, use that correction to draft the identified capability,
mechanism, decision, contribution or scope more clearly from the existing evidence. Merely deleting
the proposed edits, reordering original bullets or changing target quotes does not resolve that
finding. Correct incomplete summary/headline citations in the same pass. Do not impose an edit quota,
force differences across JDs or invent material to satisfy the reviewer.

If the source wording already expresses the strongest relevant evidence, identify the specific
passages and explain why further wording would add no supported information; report a limited
tailoring result honestly. Missing optional details stay as later questions. Fix a precise validation
error without weakening the guard or using a raw-content endpoint to evade it. If a factual or
page-fit issue remains, preserve the proposed scratch payload and explain it. A rejected create is
not a saved product variant. Do not repeatedly rewrite until the writer's own score increases.

## Three separate evaluations

- **Original-source fit:** the saved original evidence versus the JD; rewriting never changes this
  score or silently raises the user's application threshold.
- **Document alignment:** use the same atomic JD criteria before and after. Show which supported
  concepts became clearer, which were already present, and which remain absent. Label this an
  internal review, not an employer's score or a predicted screening probability.
- **PDF quality:** inspect the actual registered artifact. Require one US Letter page, canonical
  Computer Modern fonts, intact text, readable layout, working links and no clipping. Compare the
  exact extracted PDF text with the saved content, not merely the intended TeX string.

Report failures separately. A readable one-page PDF can still have weak relevance; clearer wording
does not resolve missing experience or eligibility. No preview establishes an employer ATS pass.
