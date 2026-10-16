# Application questions

Start with `openapply-api GET /api/health`. Read
`GET /api/jobs/<jobId>/questions` for this owned job's current definitions, collection
version and answers. These records describe observed forms; they do not authorize
submission or establish that hidden branches were completely inspected.

Prefer the code-only collection actions in the job panel. The public collector uses
Greenhouse's documented read API. Lever, Ashby, unsupported controls and unresolved
conditions require the explicit computer inspection action. Collection needs no model
or application lease. The companion owns its browser gate and blocks submissions.

Work authorization and sponsorship answers come from the profile's `workAuthorization` entry
for the country you would work in. When a posting lists several locations and one is in the
user's own country, that is the country. Fill fields the profile (`GET /api/user`) or resume answers yourself: contact details,
work authorization, sponsorship, relocation, start date, salary and EEO/veteran/disability
choices (pick the form's "decline" option when the profile leaves one blank). Education and
employment sections (school, degree, field, dates; employer, title, location, dates, role
description) come from the profile's `educationHistory` and `workHistory`, newest first; a blank
job `end` means current. Use the resume only where the profile has no entry. The profile's
`applicationAnswers` holds the user's answers to common screening questions: 18 or older, basic
qualifications, Unix/Linux, security clearance, graduation date, languages, how they heard,
employee referral, worked here before, relatives there, conflicts of interest, second job,
criminal conviction, background check, drug screening, non-compete, phone type, text messages
and travel. Use a saved answer for any wording of that question; a blank one is a missing fact.
Map it to the form's closest option: "How did you hear about us" is the career page option
("Company Website", "Careers Page"; otherwise "Other" typed as "Career page"; only without an
Other option the closest online choice). Worked here before stays No unless the resume shows
that employer or a subsidiary. Conflict-of-interest No covers relatives employed there, close
personal or financial ties with employees, ties to a government official, recent work for its
auditor, and a second job or outside business (personal and portfolio projects are not outside
work). A non-compete Yes that the form follows up on (whose, its terms, a copy) is a question
for the user. Travel "Any amount" answers Yes to any travel requirement. GPA comes from the profile (`gpa` out of `gpaScale`): pick
the range containing it, or enter it where a number is asked. A transcript upload uses the
profile transcript: save it with `openapply-api GET /api/user/transcript --out
"$OPENAPPLY_TEMP/<job>-transcript.pdf"` and stage it with `openapply-stage`. When the posting
wants resume and transcript in one PDF and the form takes several files, upload both; if it
takes one file, upload the resume. Record a GPA or transcript question only when the profile
has none. Street address, unit and
postal code come from the profile address. Never record those as questions. If an already authorized application worker observes a field neither
covers, persist the exact bounded definition through `PUT /api/jobs/<jobId>/questions/observations`:
reuse a request UUID on uncertain transport; include the current
`expectedCollectionVersion`, `source:"browser_dom"`, exact owned `sourceUrl`,
`collectorVersion`, honest `coverage`, and `definitions`. Each definition keeps its
stable field identity, exact prompt/options, requiredness, visibility, condition,
group mode and typed fields. Read the shared contract before constructing this body.
Do not infer hidden conditions or mark an unknown/custom field complete. On a conflict,
reload and reconcile observations; never overwrite a changed definition blindly.

Do not create a second Pilot question for the same collected field. Link the user to
`/needs-you`, preserve the page and return the named blocker. Reserve operational
questions for codes, runtime approvals and decisions that are not application fields.
Keep secrets out of ordinary question records.

Use an answer only when its current question revision has a non-null `confirmedAt`
and its typed field identity, wording/options and country context match the actual
field. A legacy answer or assistant suggestion without confirmation remains unknown.
Only the signed-in person may POST to `/api/application-questions/<id>/answers`;
an agent token cannot confirm facts. Do not convert a human answer to a different
question, opposite meaning or country. The saved-answer bank can offer a matching
draft in the web UI, but it becomes usable on this job only after the person
confirms the current question. Agents must not call bank matching or mutation
endpoints, manufacture reuse consent, or treat a saved bank entry as a job answer.

Changed definitions invalidate current answers while retaining history. Partial or
blocked collection stays visible as an inspection task. The API decides whether all
blockers permit resuming the queue. Pause, stop, inactive campaigns and ambiguous
submission evidence still prevent resumption. Recheck the actual form and factual
checkpoint before submission; a saved answer cannot bypass those safeguards.
