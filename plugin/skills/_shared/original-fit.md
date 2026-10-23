# Original-resume fit assessment

Use this workflow for every job fit score. The server scores the original uploaded resume against the full saved posting. Digests and tailored variants are for display or writing, never scoring evidence.

## Save the posting first

Resolve a campaign and stable job key. Read the complete posting, including qualification and responsibility paragraphs without headings. Save real title/company/location/URL and the full verbatim job description on the Job before scoring. A search snippet may create a pending, unscored discovery row; open the full posting before requesting context. If it cannot be read, leave the row unscored and report the limitation.

Create a job with `POST /api/campaigns/<id>/jobs`, or update an active row with `PATCH /api/campaigns/<id>/jobs/<key>`. Never send `matchScore`, `matchReason` or `fitAssessment` in job mutations or terminal results. Refresh a skipped row using the source-refresh action in `rescan-skipped`, not ordinary PATCH.

## Load server-owned context

Write `{ "campaignId":"<id>", "jobKey":"<key>", "resumeId":"<selected-base-id>" }` to a job-prefixed scratch JSON file; omit `resumeId` when the campaign/primary selection should be used. Then:

```bash
openapply-api POST /api/score-fit/context --data @"$OPENAPPLY_TEMP/<job-key>-fit-context-request.json" --out "$OPENAPPLY_TEMP/<job-key>-fit-context.json"
```

Read the entire returned `job.description`, `job.criteria`, `resume.text`, `preferences`, `minMatchScore`, and `basis`. `basis` contains the scoring rubric `version`, `resumeId`, `sourceSha256`, `sourceTextSha256`, `jobSha256`, and `preferencesSha256`. Copy these unchanged. Do not compute replacement hashes or supply profile, digest, resume-text, score or threshold overrides.

Use the campaign's configured minimum when present, otherwise context `minMatchScore`. A changed threshold never changes the qualification score. If `cachedAssessment` is present for this basis, use it unchanged; do not reassess identical source material until it yields a higher score. A source/context error is unresolved, not permission to use a generated PDF or older score.

The interpretation rules below are rubric version 2. New evaluations require the server to return
`basis.version:2`; never relabel a version-1 result or submit these judgments under an old version.
An unchanged saved version-1 assessment keeps its basis and is returned from cache as historical,
including for ordinary queue decisions. Do not change source text, clone jobs or alter preferences
to force a rerating. Explicit reevaluation of unchanged historical jobs needs a separate workflow,
outside this release. Unassessed jobs or genuinely changed inputs use version 2. If an older server
returns version 1 without a cached result, report that the updated rubric is not active. A version
change does not authorize a bulk rescore; fetching context never changes an existing saved score.

## Assess every criterion once

For each returned criterion id, assign `category` (`requirement`, `responsibility`, or `context`) and `rating` (`strong`, `partial`, `unsupported`, `contradicted`, `uncertain`, or `not_applicable`). Use the text's meaning, not just its section label. Responsibilities may be prose under any heading; do not require a literal Responsibilities section. Do not turn inconvenient qualifications into context.

First identify the candidate capability being assessed and explain any employer context excluded:

- Evaluate transferable work at the requested level. "Build features for Grammarly, Coda and Mail"
  asks for feature-building capability; it does not require past employment on those products.
  Cite comparable work and its limitations. Require exact product experience only when the JD
  explicitly asks for prior expertise with that product.
- An employer's audience or planned deployment is context, not automatically a prior-scale minimum.
  "Ship code reaching our 40M users" does not require previously serving 40M users. Keep actual
  reliability/engineering responsibilities and any explicitly required prior scale in the judgment.
- Offered training, learning opportunities and receiving mentorship are context when they do not
  state a present capability requirement. "Learn distributed systems with mentorship" is not a
  demand to arrive as an expert. A qualification asking for demonstrated learning ability still
  needs evidence. In a mixed sentence, assess the actual work and explain the training context.
- Preserve scope: "contribute" is not "lead", "work with" is not "own", and "Python or TypeScript"
  does not require both. Do not convert junior responsibilities into senior mastery requirements.
- Count an exact or substantively identical capability once. Keep one scored criterion, and mark
  a repeated occurrence `context`/`not_applicable` with `Duplicate of <criterionId>` and a reason.
  Prefer the explicit requirement over its repeated nice-to-have. Any extra scope, responsibility,
  qualification or minimum makes it distinct and must still be assessed. This applies equally to
  supported and unsupported duplicates; never deduplicate selectively to improve the number.
- Preserve preferred qualifications as preferred in explanations. The current formula does not
  assign a separate nice-to-have weight; do not call them mandatory or invent a new weight.

- `strong`: the original resume demonstrates all material capability clauses, including directly
  comparable transferable work. Employer names, future product context and offered training do not
  become extra qualifications. For compound capabilities, evidence for only some clauses is partial;
  one matched technology never earns full credit for the whole paragraph.
- `partial`: it demonstrates related evidence with a stated limitation.
- `unsupported`: the resume provides no evidence; absence does not prove the applicant lacks it.
- `contradicted`: exact original-resume evidence conflicts with the criterion.
- `uncertain`: the criterion or its evidence is ambiguous; explain what remains unclear.
- `context`/`not_applicable`: company description, compensation, benefits, offered development,
  instructions, headings or justified duplicate occurrences, with an explanation. Returned headings
  must use this pair. Never classify the entire posting as context or exclude genuine evidence gaps.

Every assessment includes `explanation` and `evidence:[{start,end,quote}]`. `strong`, `partial` and `contradicted` require supporting original-resume quotations. Offsets are JavaScript string indices into the returned `resume.text`: `resume.text.slice(start,end)` must equal `quote` exactly. Derive offsets programmatically from the saved context; do not type approximate offsets or quote a rewrite. An empty evidence array is honest when evidence is absent. Cover every returned criterion exactly once, even when unsupported.

Review classifications before submission: product names and promised learning must not manufacture
gaps; transferable evidence must not manufacture qualifications. Check both overly generous and
overly strict ratings against the full JD. Use `uncertain` for a real ambiguity, not as a substitute
for identifying context. The server currently assigns uncertain zero points and reports it for review.

Before the first score write, count both categories. Read task clauses such as "you will",
"what you'll do", "build", "maintain" and "collaborate" as responsibilities even under a
Qualifications heading when they describe the future job. Do not submit zero responsibilities
merely because the section parser found no matching heading. If the posting genuinely contains
none, say so in the assessment explanations; do not manufacture a responsibility. Preserve the
complete fetched posting on the Job, including context paragraphs, rather than shortening it
before scoring. Context can earn zero points without being removed from the source.

For experience requirements, distinguish dated employment, internships and projects. Sum only relevant, non-overlapping dated intervals when a duration comparison is needed; never count elapsed calendar time since the earliest entry as experience. Partial dates or unclear relevance produce an uncertain assessment, not invented tenure. Do not treat the profile's self-entered years as original-resume evidence. If the JD states no numeric years requirement, leave it unstated rather than inventing zero.

Separately classify the job's role family with exact evidence from `job.title` or `job.description`, using `{source:"title"|"description",start,end,quote}`. Allowed families: `Software engineering`, `Frontend`, `Backend`, `Full stack`, `Mobile`, `Data engineering`, `DevOps / platform`, `QA / test`, `Security`, `Other`, `Unclear`. Inspect actual responsibilities; a shared technology does not make QA, sales, support or analysis a software engineering role. The broad Software engineering preference includes Frontend, Backend, Full stack and Mobile; it does not silently include the other families.

Write the complete request using this shape; fill all assessments, not only the example entry. The role span below is valid only if `job.title` begins with `Frontend`; replace it with offsets derived from the actual returned source:

```json
{
  "campaignId": "<campaign UUID>",
  "jobKey": "<saved job key>",
  "resumeId": "<basis.resumeId>",
  "basis": {
    "version": 2,
    "resumeId": "<basis.resumeId>",
    "sourceSha256": "<basis.sourceSha256>",
    "sourceTextSha256": "<basis.sourceTextSha256>",
    "jobSha256": "<basis.jobSha256>",
    "preferencesSha256": "<basis.preferencesSha256>"
  },
  "assessments": [
    {
      "criterionId": "<returned criterion id>",
      "category": "requirement",
      "rating": "unsupported",
      "evidence": [],
      "explanation": "<why the original resume does not evidence this criterion>"
    }
  ],
  "roleMatch": {
    "family": "Frontend",
    "evidence": [{ "source": "title", "start": 0, "end": 8, "quote": "Frontend" }],
    "explanation": "<role scope shown by the full posting>"
  }
}
```

```bash
openapply-api POST /api/score-fit --data @"$OPENAPPLY_TEMP/<job-key>-fit-assessment.json"
```

The endpoint validates quotation spans and current hashes, computes score arithmetic, and saves `Job.fitAssessment` atomically. Semantic ratings remain the agent's judgments; a valid quotation does not prove the judgment is correct. Confidence describes assessment uncertainty, not probability of hiring. A stale-basis rejection requires fresh context and source inspection; it is not a reason to remove criteria. Use returned `score`, `matchReason`, `strongMatches`, `partialMatches`, `gaps`, `confidence` and `verdict` unchanged. Never independently rescore or send these values back through a job mutation.

## Decide separately from the number

Include `preferenceChecks` in every new assessment. Profile candidate lists require these saved
checks before the first score can be accepted. They use the same immutable source/preference
hashes as the score and never add qualification points:

```text
preferenceChecks: {
  level: {status, explanation, evidence},
  workMode: {status, explanation, evidence},
  employmentType: {status, explanation, evidence},
  location: {status, explanation, evidence},
  eligibility: [{requirement, status, explanation, evidence}]
}
```

For each preference, `status` is `matched`, `mismatch`, `unknown` or `not_restricted`.
An empty saved selection requires `not_restricted`; a nonempty selection cannot use it.
A match or mismatch needs an exact posting quotation. `evidence` uses
`{source:"title"|"description"|"location"|"type",start,end,quote}` with offsets into
the corresponding `context.job` string. Missing posting information is `unknown`, not a
rejection by itself. Explain it so it remains visible before form work.

The `eligibility` array records only explicit, genuinely nonnegotiable JD/form requirements
per `eligibility.md`, with `status:"met"|"not_met"|"unknown"`, exact posting evidence and
an explanation tied to confirmed applicant facts. Ordinary skill, degree or experience gaps
belong in the fit assessment unless the employer actually makes them a hard bar. Empty means
no explicit hard bar identified, not confirmed sponsorship availability. A required unknown
cannot become `met` because a resume is silent. A hard `not_met` excludes that row; a hard
`unknown` parks that row for its named missing fact. Continue other saved candidates.

Do not replace a cached score to add missing checks. Older campaigns keep their historical
assessment; report missing checks rather than falsely claiming a complete candidate review.

Read saved `jobPreferences.roles`, `levels`, `workModes`, `employmentTypes` and `preferredLocations`; empty selections are unrestricted. Include chosen roles in discovery queries. Compare each nonempty preference with the full posting before applying, without silently changing preferences. Qualification evidence remains original-resume-only; preferences never add qualification points.

`roleMatch.relevance:"outside_preferences"` excludes the job even if its score is high. A family of `Unclear` or relevance of `unclear` requires agent inspection of the full posting, even when role preferences are unrestricted; do not guess a family or mark the job eligible. Refresh source and reassess only when new posting text actually changes the basis. An identical cached assessment cannot be rerated. Park a genuinely unresolved applicant fact/preference as `needs_user` with the named question rather than silently looping the same job. Inspect level, work mode, employment type and location explicitly as well. Record a known mismatch with exact preference and JD evidence. Unknown posting facts are uncertainty, not an invented match or mismatch.

Below the campaign/context threshold means skip with `Below minimum match score (X < Y)`. Apply hard eligibility only from a JD-stated requirement and confirmed applicant facts, per `eligibility.md`; the scoring response does not decide legal eligibility. `verdict:"needs_review"` or low confidence means the agent inspects the evidence and reports candid gaps. A known role meeting the threshold may continue to the application worker for that AI review; missing assessment categories or qualification gaps alone do not create a user-approval gate. Ask only for an unresolved applicant fact or user preference decision that cannot be resolved from available evidence. Never bypass rejected evidence or an unresolved role to apply.
