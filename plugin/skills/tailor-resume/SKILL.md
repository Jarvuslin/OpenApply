---
name: tailor-resume
description: Choose the best existing resume base/variant for a job, or create a new tailored variant when nothing fits.
argument-hint: "<digest-json | job-url | pasted-jd-text> [--base <resumeId>]"
---

# Tailor Resume - Reuse or Create

Choose or produce a resume for a specific job. Honor the user's selected base; decide reuse vs create only within that base.

## Setup

Follow `../_shared/setup.md`. The profile response includes `resumes` (every base with `label`, `hasData`, `variantCount`, `isPrimary`).

## Step 1: Build the JD object

Detect the argument shape:

- A JSON object with `baseResumeId` and `job` is a dashboard request. Keep `baseResumeId` as the explicit base and parse `job` below (it may be a URL or pasted JD text).
- Otherwise extract an optional `--base <resumeId>` argument before detecting the JD shape. If both forms provide different base IDs, stop and report the conflict.
- Starts with `{` → parse as digest JSON. Reuse the full posting from the caller or saved Job
  description. A digest alone is insufficient for rewriting: if the full text was not supplied,
  retrieve the saved job or read its real posting URL before Step 5. Keep any active form intact.
- Starts with `http` → `browser_navigate`, then `browser_snapshot` the posting body (per `../_shared/browser-tips.md`) and build the digest (`../_shared/digest-schema.md`) from it.
- Otherwise → pasted JD text; parse the same fields manually.

From the digest (`title`, `requirements[]`, `responsibilities[]`, `skills[]`, `yearsExperience`, `descriptionExcerpt`), assemble:

- `title`, `domain` (fintech/healthtech/devtools/…), `standouts` (clearance, on-call, on-site, …).
- `roleFamily` ∈ `frontend | backend | fullstack | mobile | data | ml | devops | qa | other` - match `title` + `descriptionExcerpt` against: frontend (`frontend`, `ui`, `react`, `vue`, `angular`), backend (`backend`, `api`, `services`), fullstack (`full-stack`), mobile (`ios`, `android`, `react native`, `flutter`), data (`data engineer/scientist`, `analytics`, `etl`), ml (`ml`, `ai engineer`, `mlops`), devops (`devops`, `sre`, `platform`, `infrastructure`), qa (`qa`, `sdet`, `test engineer`).
- `seniority` ∈ `junior | mid | senior | staff | lead` - from title (`junior`/`entry` → junior; `senior`/`sr.` → senior; `staff` → staff; `lead`/`principal` → lead; else mid). Cross-check `yearsExperience`: 0-2 junior, 3-5 mid, 6-9 senior, 10+ staff/lead.
- `keywords` - top 10 required skill terms from `skills` ∪ extracted from `requirements`. Lowercase, deduped, must-have ranked above nice-to-have.
- `responsibilityTerms` - top 5 verbs/nouns from `responsibilities` (`design`, `mentor`, `migrate`, `on-call`, …).

## Step 2: Pick the Base

**Explicit choice wins.** When `baseResumeId` or `--base <resumeId>` was supplied, fetch that exact
resume. Use it as `BASE_ID` if it has `content` or a `sourceFilename` (skip base scoring). If the ID
is invalid, unavailable, or has neither content nor a source, stop and report the problem. Never
substitute the primary or another base for an explicit selection.

Only without an explicit selection, **primary wins**: if `primaryResumeId` is set and that resume has `hasData` or a `sourceFilename`,
use it as `BASE_ID` (skip scoring; Step 3 extracts content if missing). Otherwise score each
`resumes` entry (max 10):

| Signal              | Points | Rule                                                                                |
| ------------------- | ------ | ----------------------------------------------------------------------------------- |
| Exact role-family   | +4     | `label` maps to `JD.roleFamily`.                                                    |
| Adjacent family     | +2     | frontend↔fullstack, backend↔fullstack, ml↔data, devops↔backend. Not both.           |
| `hasData: true`     | +1     | Enables content scoring; cheaper to tailor.                                         |
| `isPrimary: true`   | +1     |                                                                                     |
| JD keyword coverage | +0..+3 | If `hasData`, fetch base; `round(3 × matched/10)` over skills + projects + summary. |
| Recency             | +1     | `updatedAt` within 90 days.                                                         |

Highest wins. Tie-break: primary → most recent → lowest id. If no candidate has `hasData` AND no `sourceFilename`, stop:

> No usable base resume. Upload a PDF at <$OPENAPPLY_WEB/resumes>, or fill a resume's editor manually, then re-run.

Let `BASE_ID` be the chosen id.

## Step 3: Load the Base

```bash
openapply-api GET "/api/resumes/$BASE_ID"
```

If `content` is `null`, run the `extract-resume` skill for `$BASE_ID`, wait for it, and refetch - Step 5 needs the saved `content`. If extract-resume stops because there's no `sourceFilename`, surface the same message and stop.

**Check `profileMismatches`.** Non-empty means the recruiter reads one address and the form submits another. Echo once, don't block the apply:

> ⚠ resume disagrees with your profile: {field} says "{resume}", profile says "{profile}". Fix at $OPENAPPLY_WEB/resumes/{baseId}

## Step 4: Reuse only an equivalent, verified artifact

Follow `../_shared/rewrite-quality.md`. Read the full JD, not only its digest, before writing prose.
Retain its exact text as `jobDescription` for source-linked targeting.
Follow `../_shared/resume-evidence.md` to gather reusable evidence from the original, profile,
confirmed user conversations and attributable GitHub work. Reuse valid records; do not ask the
same optional question before every rewrite or promote an assistant suggestion into a fact.

List this base's variants. Reuse only when the selected source version, job requirements, requested
editing scope and canonical template match, and its saved artifact passed review. Do not choose a
weakly relevant variant because of a numeric reuse score or a variant-count cap. An explicit request
to test a new rewrite requires a new draft. Never delete submitted/history variants to make room.

On reuse, fetch the saved artifact and inspect the actual PDF before returning it. Say which version
was reused; do not claim that another rewrite happened. Continue to Step 6.

## Step 5: Create a source-grounded variant

Build a short edit plan from the original source and full JD. Apply Google XYZ where real measures
exist, otherwise use specific supported actions and outcomes. Improve relevant experience AND project
bullets; there is no arbitrary two-bullet limit. Keep useful details, employers, dates, titles and
scope intact. Every edit must be defensible from its cited source.

Send:

- `label`: company and role.
- `jobUrl`: actual posting URL when known.
- `jobDescription`: full posting text used for the target quotes.
- `emphasizedTech` and `jobKeywords`: relevant terms already supported by the source.
- `bulletRewrites`: grouped experience edits, indexed against the original selected base.
- `projectBulletRewrites`: the same shape for project edits.
- `summary` with `summaryGrounding`, or `headline` with `headlineGrounding`, only when useful.
- `diffNotes`: concrete changes, reasons, meaningful omissions and remaining evidence gaps.
- `workflowReview`: the per-JD evidence plan, actual independent-review and humanizer outcomes,
  and optional questions, using the exact shape in `rewrite-quality.md`.

Each rewrite is `{original, tailored, grounding}`. Copy `original` verbatim. Use the grounding shape
in `../_shared/rewrite-quality.md`, citing the full original bullet and any additional supporting
facts from that same entry. Source pointers and entry indexes always refer to the base before any
structure operation. Grounding is a checkable claim record, not a self-certified guarantee.
Additional supported ledger evidence uses `grounding.externalEvidence` with the exact owned
`evidenceId`, current `revision` and complete `statement` as `quote`. Never change the base to
smuggle new facts into its source evidence. Stronger phrasing may explain a capability, design
decision or outcome entailed by the evidence; it need not merely move an existing clause first.

```json
{
  "label": "<Company> - <Title>",
  "jobUrl": "<actual job URL>",
  "jobDescription": "<full posting text>",
  "emphasizedTech": ["<supported relevant tool>"],
  "bulletRewrites": [{
    "entryIndex": 0,
    "bullets": [{
      "original": "<exact source bullet>",
      "tailored": "<clearer, supported achievement/result/method>",
      "grounding": {
        "evidence": [{"path": "/experience/0/bullets/0", "quote": "<exact source bullet>"}],
        "target": {"kind": "job_description", "quote": "<exact JD criterion>", "reason": "<relevance>"},
        "review": {"verdict": "supported", "claimType": "explicit", "rationale": "<factual comparison>"}
      }
    }]
  }],
  "diffNotes": "<what changed, why, and what remains unsupported>"
}
```

Keep all entries and bullets by default. Do not set `maxBulletsPerEntry` simply to make the renderer
fit: first shorten repetition. Use explicit exclusions only within the user's editing scope and
show the omitted source text in the audit. Ordinary tailoring does not authorize merging employers,
promoting personal projects into employment or removing history.

If the user explicitly requested restructuring, the existing `structure` object supports
`entryOrder`, `dropEntries`, `mergeEntries`, `promoteProjects`, and `projectOrder`. Fetch its current
API schema before using it. No rewrite may acquire facts from another entry after a merge. All
rewrite and evidence indexes still refer to the unchanged base, not a merged intermediate.

Avoid stock phrases: passionate, results-driven, detail-oriented, self-starter, track record,
cutting-edge, leverage, spearheaded, seasoned, production-grade and best practices. Use precise
source facts instead. Run the independent reviewer and invoke `humanizer` before saving, with the
bounded correction in `rewrite-quality.md`. Missing optional facts do not block this work.

Write the body to a job-prefixed file under `OPENAPPLY_TEMP`, then:

```bash
openapply-api POST "/api/resumes/$BASE_ID/tailor" --data @"$OPENAPPLY_TEMP/$JOB_KEY-tailor.json"
```

A validation failure names the rejected field and reason. Correct the factual issue; never bypass
it through a raw variant endpoint. A compilation or PDF-fit failure is not a completed rewrite.
Keep the proposed payload in the job scratch file and report the diagnostics. A failed create
returns no variant ID; do not claim that a draft was saved in OpenApply.

A timeout or lost response has an unknown outcome. Before resending, list the base's variants and
inspect newly created candidates for the same job, content and audit. Reuse the matching saved
artifact if the first request succeeded. If the outcome cannot be reconciled, report it instead of
blindly creating another copy.

## Step 6: Verify the registered artifact

Fetch `GET /api/resumes/variants/<id>` and its generated artifact metadata. Download the exact saved
PDF and LaTeX source through the returned routes; do not run an independent PDF generator, replace a
cache file, or claim that a standalone file belongs to an unrelated variant ID.

```bash
openapply-api GET "/api/resumes/variants/$VARIANT_ID/artifacts"
```

Read `.artifact`, including `revision`, `pdfSha256`, `pdfUrl`, `texUrl`, `metadataUrl`, `source`,
`job` and `validation`. Download the returned `pdfUrl` and `texUrl` with `openapply-api --out`.
A null artifact means no current generated file exists. For a deliberately selected older draft,
POST `/api/resumes/variants/<id>/artifacts` to convert it explicitly, then review it. Do not claim
that this conversion recovers the exact file from a historical application.

Compare the saved content and `rewrites` audit against the original source. Inspect the actual PDF
visually and verify one page, canonical fonts, readable text and no clipping. Use the persisted
artifact revision/hash when reporting the file so preview and eventual staging identify the same
bytes. If any review cannot be performed, say which check is incomplete.

Report a concise before/after comparison, source support, clearer JD evidence, remaining gaps and
links to the saved resume, PDF and LaTeX. Echo nonblocking server `flags` as review concerns. Keep
original-source scoring separate from this document review; never label either as an ATS pass rate.

## Return to the caller

Only return an application-ready document after its actual artifact passes review:

> Created/reused variant {id} from base {baseId} ({rewordedBullets} rewritten bullets).
> [Rewritten PDF](<API origin + saved artifact.pdfUrl>)
> `RESUME_USED base={baseId} variant={id}`

For preview-only requests, explicitly say no application was submitted. For a failed or incomplete
artifact, return only links that actually exist and the failure, not an application-ready
`RESUME_USED` marker. A rejected create has no saved variant link. Preserve
an explicit original-PDF submission preference; previewing a variant does not change it.

Apply flows consume the returned IDs and must verify the downloaded file hash at staging. Omit
`variant=` only when no variant is involved and the selected base/original document is used.
