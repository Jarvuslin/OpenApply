---
name: review-resume
description: Review a freshly uploaded resume and save a stronger rewritten version as a suggestion the user accepts or discards in the dashboard.
argument-hint: "<resumeId>"
---

# Review Resume

Save one improved version of a base resume as a `Suggested rewrite` variant. The user accepts or discards it in the dashboard. **Never write to the base resume.**

Runs after `extract-resume` on upload: extraction is faithful to the PDF, this pass makes the document better.

## Setup

Follow `../_shared/setup.md`, then:

```bash
openapply-api GET /api/resumes/$RESUME_ID
```

`content: null` → extraction hasn't run; say so and stop. If `sourceFilename` is set, download the owned source through the API into `$OPENAPPLY_TEMP` using its actual extension:

```bash
openapply-api GET /api/resumes/$RESUME_ID/source --out "$OPENAPPLY_TEMP/review-source.pdf"
```

For a PDF, `Read` that downloaded file to inspect layout and emphasis. For DOCX or TXT, use `/api/resumes/$RESUME_ID/source-text` and say that visual layout was not inspected. Never read an API server's absolute storage path on the agent's computer; the two may be on different machines. If the source cannot be fetched, report the failure rather than claiming a visual review.

Follow `../_shared/rewrite-quality.md` for XYZ wording, source attribution and independent review.
Use `../_shared/resume-evidence.md` to gather valid reusable supporting facts without blocking on
optional questions. Keep added evidence separate from the original source record and fit score.
New generated documents use the canonical LaTeX format, regardless of the input layout.

## What to improve

For a human screener skimming, and the ATS parsing. Change only what's weak: where the candidate's own wording already works, keep it. Rewriting every line replaces their voice with one uniform voice, and that uniformity is what reads as generated.

- **`summary`** - two or three plain sentences about what they actually work on and their strongest specifics. Don't open with "<Title> with N years of experience" or "Results-driven <title>"; start from the work itself. Cut anything true of every candidate ("strong communicator", "team player").
- **`basics.headline`** - a role title people search for, not a slogan.
- **Bullets** - past tense for past roles; a concrete verb, then what was built or changed. Replace "Responsible for" / "Worked on" / "Helped with" with what the person did. Lead with the result when there is one, but don't force every bullet into "Verb X, resulting in Y%": a resume where every line has the same shape reads as generated. Don't start most bullets with the same verb ("Developed", "Built"). Cut a phrase that repeats across entries - one stock phrase in three roles flattens all three.
- **Projects** - improve grounded bullets: say what was built and what it does, without "a robust,
  scalable platform". Keep `description` unchanged; the guarded endpoint does not rewrite it.
- **Skill groups** - prioritize relevant existing skills; preserve the factual inventory.
- **Ordering** - surface useful evidence within each entry while keeping the existing history.

Avoid the phrases the server rejects in tailored resumes (listed in `../tailor-resume/SKILL.md`, "Summary"): if the user accepts this rewrite, it becomes the base every tailored variant starts from.

Then run the `humanizer` skill in **embedded mode** on the summary, headline, bullets, and project descriptions you changed.

## Rules

Review the original source and every changed claim before saving. User acceptance and server checks
do not replace factual review:

1. **Ground every claim.** Preserve employer, date, title, degree, school and original measurements.
   Use additional facts only through validated, correctly attributed evidence references. Never
   round a metric, infer a date, upgrade a title or invent a result. Keep unsupported details out.
2. **`diffNotes` lists every change**, one per line, specific enough to check: `Summary: rewritten to lead with the HIPAA platform`. A change not in the notes is one the user can't decline - if you can't list it, don't make it.
3. **Keep every entry.** Dropping or merging roles is `tailor-resume`, which has server-side guards.
4. **Don't touch `basics` contact fields.** At onboarding the resume fills the profile, so it's the source of truth.
5. If the resume is already good, save nothing and say so. A suggestion the user rejects teaches them to ignore the next one.

## Save

`label` must be exactly `Suggested rewrite` - the dashboard finds it by that label and the retention
sweep skips it. Use the guarded tailoring endpoint for agent-authored prose, with `bulletRewrites`,
`projectBulletRewrites`, and any `summary`/`headline` plus their grounding records. Use
`target.kind: "general_review"`, exact source quotes and base indexes as described in
`../_shared/rewrite-quality.md`. Keep all entries and contact fields; do not send `structure` or a
bullet cap. Include `workflowReview` recording the actual independent reviewer and humanizer pass,
per-change evidence plan, and optional questions. Write the payload to
`$OPENAPPLY_TEMP/<resume-id>-suggested-rewrite.json`, then:

```bash
openapply-api POST /api/resumes/$RESUME_ID/tailor --data @"$OPENAPPLY_TEMP/<resume-id>-suggested-rewrite.json"
```

Do not switch to the raw full-content variant endpoint to evade a grounding rejection. Correct the
specific evidence or claim problem once; otherwise report it and preserve the source.

Then:

> Suggested a rewrite of {label}: {one-line summary}.
> Review and accept at $OPENAPPLY_WEB/resumes/$RESUME_ID

Retrieve the saved artifact metadata, PDF and LaTeX through the returned API routes. Inspect the
actual PDF for one page, canonical fonts, intact text and readable layout before describing it as
ready. If creation fails, retain the scratch payload and diagnostics; no variant exists until the
API confirms it. If only review fails, link the saved artifact as incomplete. Include
the original and generated PDF links, plus a concise factual before/after comparison. Do not wait
for acceptance or apply the suggestion to the base yourself.
