---
name: cover-letter
description: Write a factual cover letter or application prose answer from the original resume and confirmed user facts, respecting the exact form question and limit.
argument-hint: "<job_description>"
---

# Cover Letter

Write the letter a good candidate would write in fifteen minutes: short, specific, plain. The reader should learn one or two real things about the candidate and want to talk to them.

## Setup

Follow `../_shared/setup.md`, then load the selected resume (the caller's `resumeId`, else `user.primaryResumeId`):

```bash
openapply-api GET "/api/resumes/$RESUME_ID"
```

Use the original resume text already returned by the application worker's scoring context, plus explicit confirmed profile/user facts, for factual claims. Structured `content` and tailored wording may help organization, but are not proof that a claim appeared in the original. If original evidence was not passed, download `GET /api/resumes/<id>/source` to a job-prefixed scratch file and read that source with available document tools; report an unreadable source instead of treating edited content as identical. Preserve employer names, role titles, dates, education and metrics. Keep projects, internships and employment distinct.

When called for an application field, accept its exact question, confirmed character/word limit and relevant original evidence. A field answer may be much shorter than a letter and normally omits header and sign-off. Do not claim personal history, passion, referrals or preferences merely because the job description suggests them.

## Step 1: Read the job

From the argument, note the company and what it does, the role and level, the two or three things the job most needs, the stack and domain, and the tone (startup casual or enterprise formal).

## Step 2: Read your last five letters

Letters that are each fine but all the same shape are what reads as AI. Don't skip this.

```bash
openapply-api GET /api/cover-letters --query page=1 --query limit=5
```

The list is metadata only, so `GET /api/cover-letters/<id>` for each `.items[].id`. From each, keep four things and drop the rest: what it led with, its first sentence, its last sentence, and how it phrased its numbers. No history → skip to Step 3.

## Step 3: Choose what to say

Pick one lead, the strongest for this job:

- the result closest to their main need (for senior roles: scope, architecture, what the team shipped)
- direct experience with their stack, domain, or product (for research roles: publications)
- a real, specific reason for this company, only if the resume or JD gives you one

Don't lead with what either of the last two letters led with, unless the JD leaves no honest alternative (a healthcare role wants the healthcare project).

Then pick one or two proof points that fit this job, not your two best overall: a named project or role with one concrete detail each.

## Step 4: Write

**Header.** Values from `user.*` only, never the resume (resumes carry stale addresses). Drop any line whose fields are empty:

```
[Full Name]
[City, State] | [Phone] | [Email]
[LinkedIn] | [GitHub] | [Website]
```

**Body.** For a standalone letter, use 150-250 words in three or four paragraphs. An application field's question and confirmed limit override that default:

- **Open** with your lead in one to three sentences. Name the role somewhere in the letter, not necessarily first: "I'm applying for the X role at Y" is the opening every letter uses.
- **Proof** in one or two short paragraphs. Say what you did and what happened. Don't explain why it's relevant; if you picked well, the reader sees it.
- **Close** in one or two sentences: you'd like to talk. A thank-you is fine. No recap of fit.

Quote at most one short phrase from the JD. Write in first person using original-resume facts and explicit user information. Explain the connection between an actual project/skill and the role; do not invent an anecdote, employer, responsibility, result or number to improve the answer.

**Sign-off:**

```
Best regards,
[Full Name]
```

## Step 5: Humanize and compare

Invoke the `humanizer` skill on the full letter in embedded mode.

Then verify every factual claim against the original evidence again; humanizing must not add or strengthen a claim. Count the final text against the exact field limit, including spaces and punctuation; unknown limits stay unknown. The application worker must read back the pasted value and detect truncation. Compare against the Step 2 notes; the humanizer sees one letter and cannot do this. Fix avoidable repetition:

- no sentence reused, including how a metric is phrased (reuse the number, not the sentence)
- a different first and last sentence
- the company mentioned in a different place
- a different overall shape: if the last letters went intro, experience, tech, why-company, close, merge or drop a section

## Step 6: Save to history

Best effort; continue if it fails. Write `{"content":"<final letter>","jobUrl":"<job url>","jobTitle":"<title>","company":"<company>","source":"<source>"}` to `$OPENAPPLY_TEMP/cover-letter.json`, omitting empty `jobUrl`/`jobTitle`/`company`:

```bash
openapply-api POST /api/cover-letters --data @"$OPENAPPLY_TEMP/cover-letter.json"
```

Take `jobUrl`/`jobTitle`/`company` from the JD argument (`$DIGEST` fields when present). `source` is the caller: `apply`, `auto_apply`, or `manual` (the default).

## Output

Plain text ready for the requested use: header/sign-off for a letter, direct prompt-specific prose for an application field. Report an unresolved required factual claim instead of filling it with a plausible story.
