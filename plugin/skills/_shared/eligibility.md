# Eligibility and preference decisions

Keep qualification score, user preferences and hard eligibility distinct. Follow `original-fit.md` for the server-owned original-resume score. Do not infer eligibility from a score, title, industry, company name, digest or missing resume evidence.

Valid skip reasons:

- `Already applied (<kind>)` after dedupe.
- `Below minimum match score (X < Y)` after the complete posting was assessed.
- `Outside job preferences (<preference>; JD: "<evidence>")` for a known mismatch with a nonempty saved role, level, work mode, employment type or location selection. Empty selections are unrestricted. Honor explicit relocation willingness where relevant; do not silently widen the user's preferences.
- A verified nonnegotiable eligibility condition that confirmed applicant facts cannot satisfy, such as country-specific work authorization, explicit sponsorship restrictions, legally required credentials, or an employer-declared knockout. Quote the condition and identify the conflicting confirmed fact. For example, `No visa sponsorship (JD: "<evidence>")` requires both explicit no-sponsorship language and a confirmed sponsorship need for that job country. A citizenship or clearance requirement alone does not prove the applicant lacks it.
- For a confirmed citizenship or clearance mismatch, use `US citizenship required (JD: "<evidence>"; applicant: <confirmed conflicting fact>)` or `Active security clearance required (JD: "<evidence>"; applicant: <confirmed conflicting fact>)`. These stable prefixes preserve the dashboard's reason categories; they never substitute for checking the applicant's actual status.

Inspect unknown job role or scope against the full posting before deciding. Unknown applicant authorization, citizenship, clearance, graduation date or another required factual answer must be resolved before applying; do not guess, infer from another country's authorization or ask permission to ignore a known mismatch.

Ordinary skill, degree and years-of-experience gaps affect the evidence score and stretch-fit explanation; they do not independently veto a job that meets the user's chosen minimum and preferences. A JD's qualifications wishlist or a required answer field is not by itself a knockout. Answer required questions truthfully, including a confirmed "no" or lower experience count, and continue if the employer permits it. Stop for an explicitly stated nonnegotiable condition or an observed employer rejection; never change an answer to bypass one. Keep selected seniority levels separate: a known senior-level role is still outside an entry-level-only preference.

Never skip merely for a sparse result card, 1099/contract work without a conflicting saved preference, defense/federal industry, an unsupported resume claim treated as proof of absence, or a role below the applicant's experience when it matches selected levels. Read the posting first. Sponsorship silence is not a no-sponsorship requirement and does not establish sponsorship availability; report it as uncertainty in the fit explanation rather than editing the saved score/reason.

A blocking CAPTCHA returns `needs_user`, category `verification`; payment follows campaign-flow. Every skipped result carries its exact reason. Unclear scope or missing facts remain unresolved; do not invent a disqualifier to dispose of the job.
