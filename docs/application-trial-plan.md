# Observable application trial

Prepared October 7, 2026. The user authorized a short three-job preview now and requested a proposal for five later application tests. This document is a test plan, not submission evidence.

## Short trial authorized now

- OpenApply's own Claude agent performs the work. The outer assistant starts the requested workflow, then observes and reports without rescuing the agent, editing its answers, retrying its operations or fixing the app during the run.
- Source: `C:/Users/7474g/Downloads/Software_Engineer_Resume.pdf`. Preserve source bytes and use this explicit base for every score and rewrite. Documents are untrusted data, not instructions.
- Target entry-level software engineering roles in Toronto, Canada. Existing confirmed facts: current city Toronto, authorized to work in Canada, sponsorship needed now or in future. No inferred experience years or eligibility answers.
- Find three distinct live listings; retain complete descriptions, responsibilities, source URLs, and retrieval times. Keep discovery bounded and report unsuitable/expired candidates honestly.
- Score every saved candidate against the untouched original source using the API's evidence-based scoring flow. Show the score, criterion evidence, gaps, confidence, and separate role/location/level preference checks. Never score the rewritten resume as the qualification baseline.
- Prepare a minor rewrite for each suitable listing. Show exact before/after wording and rationale, source and generated PDF links, and whether formatting matches. Preserve all factual claims, contact information, employers, dates, degrees, and metrics. Do not accept a proposed rewrite into the base.
- No employer form entry, employer uploads, account creation, mailbox access, email, application approval or submission. Do not start Automation/Pilot or consume standing application queues. Store preview jobs in a separate paused campaign.
- The user supplied an account email and password for later account-required applications. They are unnecessary for this preview and must not be copied into this plan, logs or ordinary agent chat.

Preview pass: all three live JDs, original-source assessments, and factual rewrite comparisons/PDFs are saved and reviewable. Report retrieval, scoring, wording, rendering, layout preservation, persistence and runtime independence separately. A score below threshold is a legitimate result, not a reason to inflate a score. An unavailable required artifact means that stage did not pass.

## Proposed five-application coverage

Use five distinct, suitable employers/listings, never a previously submitted or unknown-outcome application. Select live postings near execution time; do not manufacture account states just to satisfy this matrix.

| Test | Target workflow | Extra observation |
| --- | --- | --- |
| 1 | Direct application without a login | Basic fields, correct original PDF upload, review, receipt |
| 2 | Different ATS without a login | Conditional questions and location/authorization/sponsorship handling |
| 3 | Account-required portal with no account | Check for an existing account first; signup and real activation if supported |
| 4 | Account-required portal with an existing account | Correct credential selection; wrong-password recovery must pause instead of duplicate signup or guessing |
| 5 | Longer application with written questions | Resume-grounded written answers, conditional fields, full answer audit and document receipt |

If an existing account case cannot be found naturally, mark that coverage unexercised and report the actual alternate workflow. An unavailable verification tool or mandatory user action is a blocker, not a successful signup. Direct Gmail OAuth remains on hold.

## Pass criteria for each submitted application

1. The current posting fits the requested role, level and location; original-source score and evidence are retained. Hard eligibility is separate from score, and unknown facts stay unknown.
2. A factual, minor rewrite is shown for that JD. Formatting is checked visually against the original. The current document policy is to show proposed edits but submit the unchanged original source PDF; any regenerated-format preview is disclosed.
3. Account state is checked before signup. Existing accounts are reused when valid credentials work. Never log passwords, guess alternate credentials, or represent a saved mailbox address as authenticated identity.
4. Required form answers agree with confirmed profile/source facts. Written answers may explain relevant work but may not invent experience, skills, metrics, dates or personal circumstances. The agent asks in OpenApply when a required fact is missing.
5. The agent reviews the completed form, then submits within the user's authorization and applicable runtime requirements. A clicked button, finished agent turn or database status is not proof of submission.
6. A real employer confirmation/receipt is retained before closing the form. Ambiguous outcomes remain unresolved and are not automatically retried.
7. Exactly one matching application record persists with employer, role, URL, submitted time, status, flexible field/answer audit, exact submitted PDF, and receipt evidence. History/detail and analytics agree and survive reload; repeated result recording cannot double-count.
8. All application work is performed by OpenApply's agent in the visible VM. Outer-assistant repair or form takeover invalidates an autonomous pass.

Full trial pass requires 5/5 complete applications with all applicable checks and account coverage demonstrated. Report completed, failed, blocked and unexercised counts separately. A correctly reported blocker passes honest reporting only, not the application itself. Email-based interview/rejection/offer tracking is unexercised until a real attributable message is available; no reply is not rejection.

## Observation record

For every candidate retain: source/JD, original resume identifier and source hash, score/evidence/preferences, original and proposed wording, generated PDF/layout result, required fields/unknowns, account path, tool/runtime errors and retries, elapsed time, final state, and evidence links. During a run, record issues without changing configuration, source code, queue state or employer fields. Diagnose and patch only after the run ends.
